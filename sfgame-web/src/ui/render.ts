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
  planeTrail: Trail
  press: PressVisual | null
  now: number
}

const PAGE = '#fdf7ec'
const HOT = { r: 255, g: 90, b: 60 }
const COLD = { r: 61, g: 139, b: 255 }
const TRAIL_INK = { r: 107, g: 91, b: 69 }
const GOAL = '#2fbf71'

// ---------- 视觉参数（世界单位，关卡 76×56 尺度） ----------

const SUN_POS = { x: 12, y: 9.5 }
const SUN_RADIUS = 4
const SUN_BREATH_AMP = 0.12
const SUN_BREATH_PERIOD = 700

const TEMP_LEVELS = 5
/** 温度归一化基准：实测四源解粒子温度 p95≈5.3，取 5 定"赤热"满饱和档 */
const T_REF = 5
const LINE_COLORS = [
  [61, 139, 255],
  [116, 154, 208],
  [170, 168, 160],
  [212, 129, 110],
  [255, 90, 60],
]
const HEAD_COLORS = [
  [61, 139, 255],
  [116, 154, 208],
  [170, 168, 160],
  [212, 129, 110],
  [255, 90, 60],
]
/** 头部点透明度按档递减：自然温度最透（半透明浅灰），冷热端更实 */
const HEAD_ALPHA = [0.8, 0.65, 0.45, 0.65, 0.85]
const HEAD_ENV_ALPHA = [0.4, 0.92]
const LINE_ALPHA_MAX = 0.2
const TRACER_LINE_WIDTH = 0.3
const TRACER_HEAD_RADIUS = 0.3
const GUST_BASE = 0.7
const GUST_BOOST = 0.6
const GUST_FULL_SPEED = 4
/** 风速平方低于此值视为静止空气：不画线也不画粒子（"有风才见线"） */
const CALM_AIR_SPEED2 = 0.16
const VISIBLE_ALPHA = 0.02
const SOURCE_POP_RATE = 9
const SOURCE_GLOW_RADIUS = 4.8
const SOURCE_CORE_RADIUS = 1.15

/** 飞机阴影：平行光投影（沿太阳方向随高度偏移）+ 贴地坡度旋转。
 * 单层椭圆填充（半影柔边在 1.5 单位尺度下收益过低，省去双层的路径构建） */
const SHADOW_RADIUS = 1.5
const SHADOW_RY = 0.32
const SHADOW_LIFT = 0.12
const SHADOW_MAX_ALPHA = 0.3
/** 光投影的水平偏移系数：偏移量 = 高度 × 该值（太阳高度角高则小） */
const SHADOW_OFFSET_RATIO = 0.35
const SHADOW_FADE_ALT = 16

/**
 * Canvas 2D 渲染器：极简矢量风。
 * 世界坐标 y 向下；视口按 contain 适配，世界边界外由延伸的天空与大地填充，
 * 竖屏/宽屏下没有"死"留白。
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
  /** 静态层（底色 + 天空渐变 + 地形）离屏缓存：画布尺寸/关卡不变时每帧整层 blit */
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

    // 天空渐变锚定世界 0..h；视口超出部分由渐变端色自然延伸
    const sky = g.createLinearGradient(0, 0, 0, h)
    sky.addColorStop(0, '#fff8ea')
    sky.addColorStop(1, '#f8e2bb')
    g.fillStyle = sky
    g.fillRect(viewL, viewT, viewR - viewL, viewB - viewT)

    // 地形延伸出世界边界：填满竖屏/宽屏视口
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

    // 太阳光晕（静态层；呼吸动效在动态层）
    const halo = g.createRadialGradient(SUN_POS.x, SUN_POS.y, 0, SUN_POS.x, SUN_POS.y, SUN_RADIUS * 3)
    halo.addColorStop(0, 'rgba(255, 196, 83, 0.4)')
    halo.addColorStop(1, 'rgba(255, 196, 83, 0)')
    g.fillStyle = halo
    g.beginPath()
    g.arc(SUN_POS.x, SUN_POS.y, SUN_RADIUS * 3, 0, Math.PI * 2)
    g.fill()

    // 目标区静态部分：感应虚线圆 + 光柱（落点垫呼吸与旗帜摆动在动态层）
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

  private drawSun(ctx: CanvasRenderingContext2D, now: number) {
    ctx.fillStyle = '#ffc453'
    ctx.beginPath()
    ctx.arc(
      SUN_POS.x,
      SUN_POS.y,
      SUN_RADIUS + SUN_BREATH_AMP * Math.sin(now / SUN_BREATH_PERIOD),
      0,
      Math.PI * 2,
    )
    ctx.fill()
  }

  private drawGoal(ctx: CanvasRenderingContext2D, sim: LevelSimulation, now: number) {
    const g = sim.level.goal
    const gy = sim.level.ground(g.x)
    const pulse = 1 + 0.06 * Math.sin(now / 320)

    ctx.fillStyle = 'rgba(47, 191, 113, 0.3)'
    ctx.beginPath()
    ctx.ellipse(g.x, gy - 0.1, g.r * 0.62 * pulse, 1.0, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(47, 191, 113, 0.75)'
    ctx.lineWidth = 0.3
    ctx.beginPath()
    ctx.ellipse(g.x, gy - 0.1, g.r * 0.62 * pulse, 1.0, 0, 0, Math.PI * 2)
    ctx.stroke()

    // 旗帜：波幅与顺风倾斜随目标处实测风速——风与画面同呼吸
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

  /** 源光晕精灵：渐变烘焙成离屏位图（iOS WebKit 上每帧 createRadialGradient 既贵又有累积风险） */
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
    if (this.sourceGlows.size > sim.sources.length) {
      const alive = new Set<number>()
      for (const s of sim.sources) alive.add(s.id)
      for (const id of this.sourceGlows.keys()) {
        if (!alive.has(id)) this.sourceGlows.delete(id)
      }
    }

    for (const s of sim.sources) {
      const grabbed = press?.kind === 'remove' && press.sourceId === s.id
      const pop = 1 - Math.exp(-(sim.time - s.born) * SOURCE_POP_RATE)
      const pulse = 1 + 0.05 * Math.sin(sim.time * 4 + s.id * 1.7)
      const c = s.kind === 'hot' ? HOT : COLD

      if (pop > VISIBLE_ALPHA) {
        let sprite = this.sourceGlows.get(s.id)
        if (!sprite) {
          sprite = this.glowSprite(s.kind)
          this.sourceGlows.set(s.id, sprite)
        }
        const glowR = SOURCE_GLOW_RADIUS * pop
        ctx.drawImage(sprite, s.x - glowR, s.y - glowR, glowR * 2, glowR * 2)
      }

      const coreR = SOURCE_CORE_RADIUS * pop * pulse * (grabbed ? 1.18 : 1)
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

  /** 共享采样临时量：热路径零分配 */
  private static tmpAir = { x: 0, y: 0 }
  /** 各粒子温度分桶（本帧有效）：头部绘制免重复采样 */
  private tracerTemp = new Uint8Array(0)

  /**
   * 风的线条（streakline）：透明度 × 温度双维分桶，每桶一次 stroke 批量描边。
   */
  private drawTracers(
    ctx: CanvasRenderingContext2D,
    sim: LevelSimulation,
    tracers: Tracers,
  ) {
    const ALPHA_LEVELS = 4
    const paths: Path2D[] = []
    const heads: Path2D[] = []
    for (let t = 0; t < TEMP_LEVELS; t++) {
      for (let a = 0; a < ALPHA_LEVELS; a++) paths.push(new Path2D())
      for (let a = 0; a < HEAD_ENV_ALPHA.length; a++) heads.push(new Path2D())
    }
    const { trailX, trailY, trailO, trailN, odo, count } = tracers
    const trailLen = tracers.trailLen
    const fluid = sim.fluid
    const air = Renderer.tmpAir
    const levels = this.tracerTemp
    if (levels.length < count) {
      this.tracerTemp = new Uint8Array(count)
    }
    const tempLevelOf = (i: number) => {
      const f = Math.max(-1, Math.min(1, fluid.sampleTemp(tracers.x[i], tracers.y[i]) / T_REF))
      // f∈[-1,1] → 五档：0 冷 / 1 凉 / 2 自然 / 3 暖 / 4 赤热
      return Math.min(TEMP_LEVELS - 1, ((f + 1) * 2.5) | 0)
    }

    for (let i = 0; i < count; i++) {
      const n = trailN[i]
      if (n === 0) continue
      const env = tracers.envelope(i)
      if (env <= VISIBLE_ALPHA) continue
      fluid.sampleVelocity(tracers.x[i], tracers.y[i], air)
      const sp2 = air.x * air.x + air.y * air.y
      if (sp2 < CALM_AIR_SPEED2) continue
      const gust = GUST_BASE + GUST_BOOST * Math.min(1, Math.sqrt(sp2) / GUST_FULL_SPEED)
      const tl = tempLevelOf(i)
      levels[i] = tl

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
        if (a > VISIBLE_ALPHA) {
          let b = (a * ALPHA_LEVELS) | 0
          if (b >= ALPHA_LEVELS) b = ALPHA_LEVELS - 1
          const p = paths[tl * ALPHA_LEVELS + b]
          p.moveTo(px, py)
          p.lineTo(nx, ny)
        }
        px = nx
        py = ny
      }
    }

    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = TRACER_LINE_WIDTH
    for (let t = 0; t < TEMP_LEVELS; t++) {
      const c = LINE_COLORS[t]
      for (let b = 0; b < ALPHA_LEVELS; b++) {
        const a = (((b + 0.5) / ALPHA_LEVELS) * LINE_ALPHA_MAX).toFixed(3)
        ctx.strokeStyle = `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`
        ctx.stroke(paths[t * ALPHA_LEVELS + b])
      }
    }

    for (let i = 0; i < count; i++) {
      const env = tracers.envelope(i)
      if (env <= VISIBLE_ALPHA) continue
      fluid.sampleVelocity(tracers.x[i], tracers.y[i], air)
      const sp2 = air.x * air.x + air.y * air.y
      if (sp2 < CALM_AIR_SPEED2) continue
      // 无轨迹点的粒子：头部现算温度，避免用陈旧分桶
      const tl = trailN[i] === 0 ? tempLevelOf(i) : levels[i]
      const r = TRACER_HEAD_RADIUS
      const p = heads[tl * HEAD_ENV_ALPHA.length + (env >= 0.5 ? 1 : 0)]
      p.moveTo(tracers.x[i] + r, tracers.y[i])
      p.arc(tracers.x[i], tracers.y[i], r, 0, Math.PI * 2)
    }
    for (let t = 0; t < TEMP_LEVELS; t++) {
      const c = HEAD_COLORS[t]
      ctx.fillStyle = `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${(HEAD_ALPHA[t] * HEAD_ENV_ALPHA[0]).toFixed(3)})`
      ctx.fill(heads[t * HEAD_ENV_ALPHA.length])
      ctx.fillStyle = `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${(HEAD_ALPHA[t] * HEAD_ENV_ALPHA[1]).toFixed(3)})`
      ctx.fill(heads[t * HEAD_ENV_ALPHA.length + 1])
    }
  }

  /** 纸飞机拖尾：按路程淡出的淡墨折线（停驻时可见）；
   * 按存留比例分桶批量描边，移动端从最多 ~150 次路径提交降到 5 次。 */
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

    let px = trail.xAt(0)
    let py = trail.yAt(0)
    for (let k = 0; k < n; k++) {
      const nx = k + 1 < n ? trail.xAt(k + 1) : p.x
      const ny = k + 1 < n ? trail.yAt(k + 1) : p.y
      const ret = trail.retentionAt(k)
      if (ret > VISIBLE_ALPHA) {
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
      // 桶内以存留中值为代表：透明度与线宽随桶递增，保留"尾细头粗"观感
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
    if (alt >= SHADOW_FADE_ALT) return
    // 平行光投影：影子沿光方向外移，坡度/落点按影子位置采样
    const sx = p.x + alt * SHADOW_OFFSET_RATIO
    const g0 = sim.level.ground(sx - SHADOW_RADIUS)
    const g1 = sim.level.ground(sx + SHADOW_RADIUS)
    const slope = Math.atan2(g1 - g0, SHADOW_RADIUS * 2)
    const sy = sim.level.ground(sx) - SHADOW_LIFT
    // sqrt 缓降：中空仍可见，仅在高空（接近上限）快速衰减
    const fade = Math.sqrt(Math.max(0, 1 - alt / SHADOW_FADE_ALT))
    ctx.fillStyle = `rgba(61, 52, 39, ${(SHADOW_MAX_ALPHA * fade).toFixed(3)})`
    ctx.beginPath()
    ctx.ellipse(sx, sy, SHADOW_RADIUS, SHADOW_RY, slope, 0, Math.PI * 2)
    ctx.fill()

    const speed = Math.hypot(p.vx, p.vy)
    const idle = Math.max(0, 1 - speed / 3)
    ctx.save()
    ctx.translate(p.x, p.y)
    // 俯仰随垂直速度：下落低头、上升抬头（低速时收拢为待机摆动）
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
