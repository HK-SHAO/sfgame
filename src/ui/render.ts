import type { Tracers } from '../sim/particles'
import { TRAIL_FADE } from '../sim/particles'
import type { Trail } from '../sim/trail'
import type { SourceKind, Vec2 } from '../sim/types'
import type { LevelSimulation } from '../game/simulation'
import type { PressVisual } from '../game/types'
import { LONG_PRESS_MS } from './input'

export interface SceneState {
  sim: LevelSimulation
  tracers: Tracers
  /** 纸飞机的路程淡出拖尾 */
  planeTrail: Trail
  press: PressVisual | null
  now: number
}

const PAGE = '#fdf7ec'
const HOT = { r: 255, g: 90, b: 60 }
const COLD = { r: 61, g: 139, b: 255 }
const DUST = { r: 150, g: 132, b: 104 }
/** 飞机拖尾的淡墨色 */
const TRAIL_INK = { r: 107, g: 91, b: 69 }
const GOAL = '#2fbf71'

/**
 * Canvas 2D 渲染器：极简矢量风。
 * 世界坐标 y 向下；视口按 contain 适配（等比缩放 + 居中留边）。
 * 世界边界之外的视口区域由延伸的天空与大地填充，
 * 因此竖屏/宽屏下没有"死"留白，画面始终是连续的场景。
 */
export class Renderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D | null
  private cssW = 0
  private cssH = 0
  private dpr = 1
  private scale = 1
  private ox = 0
  private oy = 0

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.cssW = cssW
    this.cssH = cssH
    this.dpr = dpr
    this.canvas.width = Math.max(1, Math.round(cssW * dpr))
    this.canvas.height = Math.max(1, Math.round(cssH * dpr))
  }

  toWorld(clientX: number, clientY: number): Vec2 | null {
    const rect = this.canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const wx = (clientX - rect.left - this.ox) / this.scale
    const wy = (clientY - rect.top - this.oy) / this.scale
    const level = this.world
    if (!level) return null
    if (wx < -0.5 || wx > level.w + 0.5 || wy < -0.5 || wy > level.h + 0.5) return null
    return { x: wx, y: wy }
  }

  private world: { w: number; h: number } | null = null
  /** 静态层（底色 + 天空渐变 + 地形）离屏缓存：尺寸不变时每帧整层 blit */
  private bg: HTMLCanvasElement | null = null
  private bgKey = ''

  draw(scene: SceneState) {
    const ctx = this.ctx
    if (!ctx || this.cssW === 0) return
    const { sim, tracers, planeTrail, press, now } = scene
    const { w, h } = sim.level.world
    this.world = sim.level.world

    this.scale = Math.min(this.cssW / w, this.cssH / h)
    this.ox = (this.cssW - w * this.scale) / 2
    this.oy = (this.cssH - h * this.scale) / 2
    // 可视矩形（世界坐标）：contain 适配下恒覆盖整个世界
    const viewL = -this.ox / this.scale
    const viewT = -this.oy / this.scale
    const viewR = viewL + this.cssW / this.scale
    const viewB = viewT + this.cssH / this.scale

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.ensureBg(viewL, viewT, viewR, viewB, sim)
    ctx.drawImage(this.bg!, 0, 0, this.cssW, this.cssH)

    ctx.save()
    ctx.translate(this.ox, this.oy)
    ctx.scale(this.scale, this.scale)

    this.drawSun(ctx, now)
    this.drawGoal(ctx, sim, now)
    this.drawSources(ctx, sim, press)
    this.drawTracers(ctx, sim, tracers)
    this.drawPlaneTrail(ctx, sim, planeTrail)
    this.drawPlane(ctx, sim)
    if (press && press.kind === 'place') this.drawPress(ctx, press, now)

    ctx.restore()
  }

  /** 静态层缓存：仅当画布尺寸/缩放/关卡变化时重建，避免每帧重建渐变与地形路径。 */
  private ensureBg(
    viewL: number,
    viewT: number,
    viewR: number,
    viewB: number,
    sim: LevelSimulation,
  ) {
    const { w, h } = sim.level.world
    const key = `${this.cssW}x${this.cssH}x${this.dpr}x${w}x${h}`
    if (this.bg && this.bgKey === key) return
    this.bgKey = key
    const bg = this.bg ?? document.createElement('canvas')
    this.bg = bg
    bg.width = this.canvas.width
    bg.height = this.canvas.height
    const g = bg.getContext('2d')
    if (!g) return

    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    g.fillStyle = PAGE
    g.fillRect(0, 0, this.cssW, this.cssH)
    g.translate(this.ox, this.oy)
    g.scale(this.scale, this.scale)

    // 天空渐变锚定世界 0..h；视口超出部分由 canvas 渐变端色自然延伸
    const sky = g.createLinearGradient(0, 0, 0, h)
    sky.addColorStop(0, '#fff8ea')
    sky.addColorStop(1, '#f8e2bb')
    g.fillStyle = sky
    g.fillRect(viewL, viewT, viewR - viewL, viewB - viewT)

    // 地形延伸出世界边界：保持关卡全貌可见的同时填满竖屏/宽屏视口
    const ground = sim.level.ground
    const x0 = Math.max(0, Math.floor(viewL))
    const x1 = Math.min(w, Math.ceil(viewR))
    g.beginPath()
    g.moveTo(viewL, ground(x0))
    for (let x = x0; x <= x1; x += 1) g.lineTo(x, ground(x))
    g.lineTo(viewR, ground(x1))
    g.lineTo(viewR, viewB)
    g.lineTo(viewL, viewB)
    g.closePath()
    g.fillStyle = '#ecdcba'
    g.fill()

    g.beginPath()
    g.moveTo(viewL, ground(x0))
    for (let x = x0; x <= x1; x += 1) g.lineTo(x, ground(x))
    g.lineTo(viewR, ground(x1))
    g.strokeStyle = '#d8c193'
    g.lineWidth = 0.5
    g.stroke()

    // 太阳光晕（静态；核心的呼吸动效在动态层）
    const sx = 12
    const sy = 9.5
    const halo = g.createRadialGradient(sx, sy, 0, sx, sy, 12)
    halo.addColorStop(0, 'rgba(255, 196, 83, 0.4)')
    halo.addColorStop(1, 'rgba(255, 196, 83, 0)')
    g.fillStyle = halo
    g.beginPath()
    g.arc(sx, sy, 12, 0, Math.PI * 2)
    g.fill()

    // 目标区静态部分：感应虚线圆 + 光柱（落点垫的呼吸与旗帜飘动在动态层）
    const goal = sim.level.goal
    const gy = sim.level.ground(goal.x)
    g.strokeStyle = 'rgba(47, 191, 113, 0.35)'
    g.lineWidth = 0.28
    g.setLineDash([1.2, 1.4])
    g.beginPath()
    g.arc(goal.x, gy - 2, goal.r, 0, Math.PI * 2)
    g.stroke()
    g.setLineDash([])
    const beam = g.createLinearGradient(0, gy - 12, 0, gy)
    beam.addColorStop(0, 'rgba(47, 191, 113, 0)')
    beam.addColorStop(1, 'rgba(47, 191, 113, 0.14)')
    g.fillStyle = beam
    g.fillRect(goal.x - 1.6, gy - 12, 3.2, 12)
  }

  /** 太阳核心（动态：呼吸），光晕已烘焙进静态层。 */
  private drawSun(ctx: CanvasRenderingContext2D, now: number) {
    const sx = 12
    const sy = 9.5
    ctx.fillStyle = '#ffc453'
    ctx.beginPath()
    ctx.arc(sx, sy, 4 + 0.12 * Math.sin(now / 700), 0, Math.PI * 2)
    ctx.fill()
  }

  /** 目标区动态部分：落点垫（呼吸脉冲）与旗帜（随风摆动）。感应圈与光柱已烘焙进静态层。 */
  private drawGoal(ctx: CanvasRenderingContext2D, sim: LevelSimulation, now: number) {
    const g = sim.level.goal
    const gy = sim.level.ground(g.x)
    const pulse = 1 + 0.06 * Math.sin(now / 320)

    // 落点垫
    ctx.fillStyle = 'rgba(47, 191, 113, 0.3)'
    ctx.beginPath()
    ctx.ellipse(g.x, gy - 0.1, g.r * 0.62 * pulse, 1.0, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(47, 191, 113, 0.75)'
    ctx.lineWidth = 0.3
    ctx.beginPath()
    ctx.ellipse(g.x, gy - 0.1, g.r * 0.62 * pulse, 1.0, 0, 0, Math.PI * 2)
    ctx.stroke()

    // 旗帜：波幅与顺风倾斜都随目标处实测风速——风与画面同呼吸
    const air = Renderer.tmpAir
    sim.fluid.sampleVelocity(g.x, gy - 5, air)
    const wind = Math.min(1.4, Math.hypot(air.x, air.y))
    const top = gy - 6
    ctx.strokeStyle = '#6b5b45'
    ctx.lineWidth = 0.34
    ctx.beginPath()
    ctx.moveTo(g.x, gy)
    ctx.lineTo(g.x, top)
    ctx.stroke()
    const wave = (0.35 + wind * 0.55) * Math.sin(now / 240)
    const lean = 0.1 * wind
    ctx.fillStyle = GOAL
    ctx.beginPath()
    ctx.moveTo(g.x, top)
    ctx.lineTo(g.x + 3.1 + lean, top + 0.9 + wave)
    ctx.lineTo(g.x, top + 2.1)
    ctx.closePath()
    ctx.fill()
  }

  /** 源光晕精灵缓存：渐变一次性烘焙成离屏位图，每帧仅 drawImage
   * （iOS WebKit 上每帧 createRadialGradient 既贵又有累积风险）。 */
  private sourceGlows = new Map<number, HTMLCanvasElement>()

  private glowSprite(kind: SourceKind): HTMLCanvasElement {
    const c = kind === 'hot' ? HOT : COLD
    const cv = document.createElement('canvas')
    cv.width = 96
    cv.height = 96
    const g = cv.getContext('2d')
    if (g) {
      const grad = g.createRadialGradient(48, 48, 0, 48, 48, 44)
      grad.addColorStop(0, `rgba(${c.r}, ${c.g}, ${c.b}, 0.32)`)
      grad.addColorStop(1, `rgba(${c.r}, ${c.g}, ${c.b}, 0)`)
      g.fillStyle = grad
      g.fillRect(0, 0, 96, 96)
    }
    return cv
  }

  private drawSources(
    ctx: CanvasRenderingContext2D,
    sim: LevelSimulation,
    press: PressVisual | null,
  ) {
    // 清理已移除源的精灵缓存（源数量很小，直接按存活集合过滤）
    if (this.sourceGlows.size > sim.sources.length) {
      const alive = new Set<number>()
      for (const s of sim.sources) alive.add(s.id)
      for (const id of this.sourceGlows.keys()) {
        if (!alive.has(id)) this.sourceGlows.delete(id)
      }
    }

    for (const s of sim.sources) {
      const grabbed = press?.kind === 'remove' && press.sourceId === s.id
      const age = sim.time - s.born
      const pop = 1 - Math.exp(-age * 9)
      const pulse = 1 + 0.05 * Math.sin(sim.time * 4 + s.id * 1.7)
      const c = s.kind === 'hot' ? HOT : COLD

      // 光晕：精灵缩放跟随生长动画，中心恒定
      if (pop > 0.02) {
        let sprite = this.sourceGlows.get(s.id)
        if (!sprite) {
          sprite = this.glowSprite(s.kind)
          this.sourceGlows.set(s.id, sprite)
        }
        const glowR = 4.8 * pop
        ctx.drawImage(sprite, s.x - glowR, s.y - glowR, glowR * 2, glowR * 2)
      }

      const coreR = 1.15 * pop * pulse * (grabbed ? 1.18 : 1)
      ctx.fillStyle = '#fffdf8'
      ctx.beginPath()
      ctx.arc(s.x, s.y, coreR, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = `rgba(${c.r}, ${c.g}, ${c.b}, 0.9)`
      ctx.lineWidth = 0.34
      ctx.beginPath()
      ctx.arc(s.x, s.y, coreR, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = `rgba(${c.r}, ${c.g}, ${c.b}, 0.95)`
      ctx.beginPath()
      ctx.arc(s.x, s.y, 0.42 * pop, 0, Math.PI * 2)
      ctx.fill()

      if (grabbed) {
        ctx.save()
        ctx.strokeStyle = 'rgba(61, 52, 39, 0.55)'
        ctx.lineWidth = 0.24
        ctx.setLineDash([0.9, 1.1])
        ctx.beginPath()
        ctx.arc(s.x, s.y, 2.2, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }
    }
  }

  /** 共享采样临时量：热路径零分配。 */
  private static tmpAir = { x: 0, y: 0 }

  private drawTracers(
    ctx: CanvasRenderingContext2D,
    sim: LevelSimulation,
    tracers: Tracers,
  ) {
    // 风的线条（streakline）：按透明度分桶批量描边，桶内共享一次 stroke。
    // 每颗粒子是一条从最旧轨迹点到当前位置的折线——点距 0.45 世界单位，
    // 在屏幕上仅数像素，折线视觉即光滑丝线；折线比贝塞尔描边成本低一半，
    // 且负载与"轨迹长度×粒子数"成正比（移动端已把轨迹长度档位调短）。
    const BUCKETS = 5
    const paths: Path2D[] = []
    for (let b = 0; b < BUCKETS; b++) paths.push(new Path2D())
    const { trailX, trailY, trailO, trailN, odo, count } = tracers
    const trailLen = tracers.trailLen
    const fluid = sim.fluid
    const air = Renderer.tmpAir

    for (let i = 0; i < count; i++) {
      const n = trailN[i]
      if (n === 0) continue
      const env = tracers.envelope(i)
      if (env <= 0.02) continue
      // 风速极低时不画线（静止空气保持干净，"有风才见线"）
      fluid.sampleVelocity(tracers.x[i], tracers.y[i], air)
      const sp2 = air.x * air.x + air.y * air.y
      if (sp2 < 0.16) continue
      // 亮度随风速增强：阵风处的线条更亮（速度 ≥4 封顶）
      const gust = 0.7 + 0.6 * Math.min(1, Math.sqrt(sp2) / 4)

      const base = i * trailLen
      const odoI = odo[i]
      const lx = tracers.x[i]
      const ly = tracers.y[i]
      let px = trailX[base]
      let py = trailY[base]
      for (let k = 0; k < n; k++) {
        const nx = k + 1 < n ? trailX[base + k + 1] : lx
        const ny = k + 1 < n ? trailY[base + k + 1] : ly
        const a = (1 - (odoI - trailO[base + k]) / TRAIL_FADE) * env * gust
        if (a > 0.02) {
          let b = (a * BUCKETS) | 0
          if (b >= BUCKETS) b = BUCKETS - 1
          paths[b].moveTo(px, py)
          paths[b].lineTo(nx, ny)
        }
        px = nx
        py = ny
      }
    }

    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 0.22
    for (let b = 0; b < BUCKETS; b++) {
      const a = (((b + 0.5) / BUCKETS) * 0.15).toFixed(3)
      ctx.strokeStyle = `rgba(${DUST.r}, ${DUST.g}, ${DUST.b}, ${a})`
      ctx.stroke(paths[b])
    }
  }

  /** 纸飞机拖尾：按路程淡出的淡墨折线——停驻时历史轨迹依然可见。
   * 按存留比例分桶批量描边（每桶一次 stroke），替代逐段 beginPath/stroke：
   * 移动端从最多 ~150 次路径提交降到 5 次，粗细感由桶中线宽近似保留。 */
  private drawPlaneTrail(
    ctx: CanvasRenderingContext2D,
    sim: LevelSimulation,
    trail: Trail,
  ) {
    const n = trail.count
    if (n === 0) return
    const p = sim.plane
    const BUCKETS = 5
    const paths: Path2D[] = []
    for (let b = 0; b < BUCKETS; b++) paths.push(new Path2D())

    // 折线段 P_k → P_{k+1}（P_n = 飞机当前位置）；点距 0.3 世界单位，视觉即光滑曲线
    let px = trail.xAt(0)
    let py = trail.yAt(0)
    for (let k = 0; k < n; k++) {
      const nx = k + 1 < n ? trail.xAt(k + 1) : p.x
      const ny = k + 1 < n ? trail.yAt(k + 1) : p.y
      const ret = trail.retentionAt(k)
      if (ret > 0.02) {
        let b = (ret * BUCKETS) | 0
        if (b >= BUCKETS) b = BUCKETS - 1
        paths[b].moveTo(px, py)
        paths[b].lineTo(nx, ny)
      }
      px = nx
      py = ny
    }

    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (let b = 0; b < BUCKETS; b++) {
      // 桶内以存留中值为代表：透明度与线宽随桶递增，保留"尾细头粗"的观感
      const ret = (b + 0.5) / BUCKETS
      ctx.strokeStyle = `rgba(${TRAIL_INK.r}, ${TRAIL_INK.g}, ${TRAIL_INK.b}, ${(0.3 * ret).toFixed(3)})`
      ctx.lineWidth = 0.1 + 0.26 * ret
      ctx.stroke(paths[b])
    }
  }

  private drawPlane(ctx: CanvasRenderingContext2D, sim: LevelSimulation) {
    const p = sim.plane
    const ground = sim.level.ground(p.x)
    const alt = Math.max(0, ground - p.y)
    if (alt < 16) {
      const sa = 0.16 * (1 - alt / 16)
      ctx.fillStyle = `rgba(61, 52, 39, ${sa.toFixed(3)})`
      ctx.beginPath()
      ctx.ellipse(p.x, ground - 0.12, 1.5, 0.32, 0, 0, Math.PI * 2)
      ctx.fill()
    }

    const speed = Math.hypot(p.vx, p.vy)
    const idle = Math.max(0, 1 - speed / 3)
    ctx.save()
    ctx.translate(p.x, p.y)
    // 俯仰随垂直速度：下落低头、上升抬头（速度低时收拢为待机摆动）
    const pitch = Math.max(-0.32, Math.min(0.32, p.vy * 0.1))
    ctx.rotate(p.angle + 0.07 * Math.sin(p.clock * 1.8) * idle + pitch)

    ctx.beginPath()
    ctx.moveTo(1.85, 0)
    ctx.lineTo(-1.35, -1.12)
    ctx.lineTo(-0.6, 0)
    ctx.lineTo(-1.35, 1.12)
    ctx.closePath()
    ctx.fillStyle = '#fffdf8'
    ctx.fill()
    ctx.lineJoin = 'round'
    ctx.strokeStyle = 'rgba(61, 52, 39, 0.5)'
    ctx.lineWidth = 0.16
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(1.85, 0)
    ctx.lineTo(-0.6, 0)
    ctx.strokeStyle = 'rgba(61, 52, 39, 0.26)'
    ctx.lineWidth = 0.12
    ctx.stroke()
    ctx.restore()
  }

  private drawPress(ctx: CanvasRenderingContext2D, press: PressVisual, now: number) {
    const progress = Math.min(1, (now - press.start) / LONG_PRESS_MS)
    // 按压即刻反馈：热源幽灵 + 冷源进度环
    ctx.fillStyle = 'rgba(255, 90, 60, 0.12)'
    ctx.beginPath()
    ctx.arc(press.x, press.y, 1.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255, 90, 60, 0.75)'
    ctx.lineWidth = 0.26
    ctx.beginPath()
    ctx.arc(press.x, press.y, 1.5, 0, Math.PI * 2)
    ctx.stroke()

    if (progress > 0.04) {
      ctx.strokeStyle = 'rgba(61, 139, 255, 0.9)'
      ctx.lineWidth = 0.4
      ctx.beginPath()
      ctx.arc(
        press.x,
        press.y,
        2.2,
        -Math.PI / 2,
        -Math.PI / 2 + progress * Math.PI * 2,
      )
      ctx.stroke()
    }
  }
}
