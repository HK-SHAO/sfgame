import type { Tracers } from '../sim/particles'
import { TRAIL_FADE, TRAIL_LEN } from '../sim/particles'
import type { Trail } from '../sim/trail'
import type { Vec2 } from '../sim/types'
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

  draw(scene: SceneState) {
    const ctx = this.ctx
    if (!ctx || this.cssW === 0) return
    const { sim, tracers, planeTrail, press, now } = scene
    const { w, h } = sim.level.world
    this.world = sim.level.world

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.fillStyle = PAGE
    ctx.fillRect(0, 0, this.cssW, this.cssH)

    this.scale = Math.min(this.cssW / w, this.cssH / h)
    this.ox = (this.cssW - w * this.scale) / 2
    this.oy = (this.cssH - h * this.scale) / 2
    // 可视矩形（世界坐标）：contain 适配下恒覆盖整个世界
    const viewL = -this.ox / this.scale
    const viewT = -this.oy / this.scale
    const viewR = viewL + this.cssW / this.scale
    const viewB = viewT + this.cssH / this.scale

    ctx.save()
    ctx.translate(this.ox, this.oy)
    ctx.scale(this.scale, this.scale)

    this.drawSky(ctx, viewL, viewT, viewR, viewB, h, now)
    this.drawGoal(ctx, sim, now)
    this.drawTerrain(ctx, sim, viewL, viewR, viewB)
    this.drawSources(ctx, sim, press)
    this.drawTracers(ctx, sim, tracers)
    this.drawPlaneTrail(ctx, sim, planeTrail)
    this.drawPlane(ctx, sim)
    if (press && press.kind === 'place') this.drawPress(ctx, press, now)

    ctx.restore()
  }

  private drawSky(
    ctx: CanvasRenderingContext2D,
    viewL: number,
    viewT: number,
    viewR: number,
    viewB: number,
    h: number,
    now: number,
  ) {
    // 渐变锚定世界 0..h；视口超出部分由 canvas 渐变端色自然延伸
    const sky = ctx.createLinearGradient(0, 0, 0, h)
    sky.addColorStop(0, '#fff8ea')
    sky.addColorStop(1, '#f8e2bb')
    ctx.fillStyle = sky
    ctx.fillRect(viewL, viewT, viewR - viewL, viewB - viewT)

    // 太阳：本游戏的力量之源
    const sx = 12
    const sy = 9.5
    const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, 12)
    halo.addColorStop(0, 'rgba(255, 196, 83, 0.4)')
    halo.addColorStop(1, 'rgba(255, 196, 83, 0)')
    ctx.fillStyle = halo
    ctx.beginPath()
    ctx.arc(sx, sy, 12, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffc453'
    ctx.beginPath()
    ctx.arc(sx, sy, 4 + 0.12 * Math.sin(now / 700), 0, Math.PI * 2)
    ctx.fill()
  }

  private drawGoal(ctx: CanvasRenderingContext2D, sim: LevelSimulation, now: number) {
    const g = sim.level.goal
    const gy = sim.level.ground(g.x)
    const pulse = 1 + 0.06 * Math.sin(now / 320)

    // 感应范围（虚线圆）
    ctx.save()
    ctx.strokeStyle = 'rgba(47, 191, 113, 0.35)'
    ctx.lineWidth = 0.28
    ctx.setLineDash([1.2, 1.4])
    ctx.beginPath()
    ctx.arc(g.x, gy - 2, g.r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()

    // 光柱
    const beam = ctx.createLinearGradient(0, gy - 12, 0, gy)
    beam.addColorStop(0, 'rgba(47, 191, 113, 0)')
    beam.addColorStop(1, 'rgba(47, 191, 113, 0.14)')
    ctx.fillStyle = beam
    ctx.fillRect(g.x - 1.6, gy - 12, 3.2, 12)

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

    // 旗帜
    const top = gy - 6
    ctx.strokeStyle = '#6b5b45'
    ctx.lineWidth = 0.34
    ctx.beginPath()
    ctx.moveTo(g.x, gy)
    ctx.lineTo(g.x, top)
    ctx.stroke()
    const wave = 0.35 * Math.sin(now / 240)
    ctx.fillStyle = GOAL
    ctx.beginPath()
    ctx.moveTo(g.x, top)
    ctx.lineTo(g.x + 3.1, top + 0.9 + wave)
    ctx.lineTo(g.x, top + 2.1)
    ctx.closePath()
    ctx.fill()
  }

  private drawTerrain(
    ctx: CanvasRenderingContext2D,
    sim: LevelSimulation,
    viewL: number,
    viewR: number,
    viewB: number,
  ) {
    const { w } = sim.level.world
    const ground = sim.level.ground
    // 地形延伸出世界边界：保持关卡全貌可见的同时填满竖屏/宽屏视口
    const x0 = Math.max(0, Math.floor(viewL))
    const x1 = Math.min(w, Math.ceil(viewR))

    ctx.beginPath()
    ctx.moveTo(viewL, ground(x0))
    for (let x = x0; x <= x1; x += 1) ctx.lineTo(x, ground(x))
    ctx.lineTo(viewR, ground(x1))
    ctx.lineTo(viewR, viewB)
    ctx.lineTo(viewL, viewB)
    ctx.closePath()
    ctx.fillStyle = '#ecdcba'
    ctx.fill()

    ctx.beginPath()
    ctx.moveTo(viewL, ground(x0))
    for (let x = x0; x <= x1; x += 1) ctx.lineTo(x, ground(x))
    ctx.lineTo(viewR, ground(x1))
    ctx.strokeStyle = '#d8c193'
    ctx.lineWidth = 0.5
    ctx.stroke()
  }

  private drawSources(
    ctx: CanvasRenderingContext2D,
    sim: LevelSimulation,
    press: PressVisual | null,
  ) {
    for (const s of sim.sources) {
      const grabbed = press?.kind === 'remove' && press.sourceId === s.id
      const age = sim.time - s.born
      const pop = 1 - Math.exp(-age * 9)
      const pulse = 1 + 0.05 * Math.sin(sim.time * 4 + s.id * 1.7)
      const c = s.kind === 'hot' ? HOT : COLD

      const glowR = 4.8 * pop
      const glow = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, glowR)
      glow.addColorStop(0, `rgba(${c.r}, ${c.g}, ${c.b}, 0.32)`)
      glow.addColorStop(1, `rgba(${c.r}, ${c.g}, ${c.b}, 0)`)
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(s.x, s.y, glowR, 0, Math.PI * 2)
      ctx.fill()

      const coreR = 1.15 * pop * pulse * (grabbed ? 1.18 : 1)
      ctx.fillStyle = '#fffdf8'
      ctx.beginPath()
      ctx.arc(s.x, s.y, coreR, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = `rgba(${c.r}, ${c.g}, ${c.b}, 0.9)`
      ctx.lineWidth = 0.34
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

  private drawTracers(
    ctx: CanvasRenderingContext2D,
    sim: LevelSimulation,
    tracers: Tracers,
  ) {
    // 风的线条（streakline）：每颗粒子的轨迹绘制成丝滑的淡出曲线。
    // 按透明度分桶批量描边：桶内共享一次 stroke，移动端也轻量。
    const BUCKETS = 5
    const paths: Path2D[] = []
    for (let b = 0; b < BUCKETS; b++) paths.push(new Path2D())
    const { trailX, trailY, trailO, trailN, odo, count } = tracers
    const fluid = sim.fluid
    const air = { x: 0, y: 0 }

    for (let i = 0; i < count; i++) {
      const n = trailN[i]
      if (n === 0) continue
      const env = tracers.envelope(i)
      if (env <= 0.02) continue
      // 风速极低时不画线（静止空气保持干净，"有风才见线"）
      fluid.sampleVelocity(tracers.x[i], tracers.y[i], air)
      if (air.x * air.x + air.y * air.y < 0.16) continue

      const base = i * TRAIL_LEN
      const m = n // 记录点数；点列 P0..Pn，Pn 为粒子当前位置
      const bucketOf = (ret: number) => {
        const a = ret * env
        if (a <= 0.02) return -1
        const b = (a * BUCKETS) | 0
        return b >= BUCKETS ? BUCKETS - 1 : b
      }
      const px = (k: number) => (k < m ? trailX[base + k] : tracers.x[i])
      const py = (k: number) => (k < m ? trailY[base + k] : tracers.y[i])
      const retAt = (k: number) =>
        1 - (odo[i] - (k < m ? trailO[base + k] : odo[i])) / TRAIL_FADE

      if (m === 1) {
        const b = bucketOf(retAt(1))
        if (b >= 0) {
          paths[b].moveTo(px(0), py(0))
          paths[b].lineTo(px(1), py(1))
        }
        continue
      }

      // 中点二次贝塞尔平滑：片段 k 从 mid(k-1,k) 到 mid(k,k+1)，以 P_k 为控制点
      let prevMx = px(0)
      let prevMy = py(0)
      const b0 = bucketOf(retAt(0))
      if (b0 >= 0) {
        const mx = (px(0) + px(1)) / 2
        const my = (py(0) + py(1)) / 2
        paths[b0].moveTo(prevMx, prevMy)
        paths[b0].lineTo(mx, my)
      }
      prevMx = (px(0) + px(1)) / 2
      prevMy = (py(0) + py(1)) / 2
      for (let k = 1; k < m; k++) {
        const mx = (px(k) + px(k + 1)) / 2
        const my = (py(k) + py(k + 1)) / 2
        const b = bucketOf(retAt(k))
        if (b >= 0) {
          paths[b].moveTo(prevMx, prevMy)
          paths[b].quadraticCurveTo(px(k), py(k), mx, my)
        }
        prevMx = mx
        prevMy = my
      }
      const bEnd = bucketOf(retAt(m))
      if (bEnd >= 0) {
        paths[bEnd].moveTo(prevMx, prevMy)
        paths[bEnd].lineTo(px(m), py(m))
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

  /** 纸飞机拖尾：按路程淡出的淡墨曲线——停驻时历史轨迹依然可见。 */
  private drawPlaneTrail(
    ctx: CanvasRenderingContext2D,
    sim: LevelSimulation,
    trail: Trail,
  ) {
    const n = trail.count
    if (n === 0) return
    const p = sim.plane
    // 点列 P0..P_{n-1} 为记录点，P_n 为飞机当前位置
    const px = (k: number) => (k < n ? trail.xAt(k) : p.x)
    const py = (k: number) => (k < n ? trail.yAt(k) : p.y)
    const retAt = (k: number) => (k < n ? trail.retentionAt(k) : 1)
    const ink = (ret: number, mul: number) =>
      `rgba(${TRAIL_INK.r}, ${TRAIL_INK.g}, ${TRAIL_INK.b}, ${(mul * ret).toFixed(3)})`

    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // 中点二次贝塞尔平滑，逐段按存留比例调透明度与粗细（尾细头粗）
    let prevMx = px(0)
    let prevMy = py(0)
    for (let k = 0; k <= n; k++) {
      const last = k === n
      const mx = last ? px(n) : (px(k) + px(k + 1)) / 2
      const my = last ? py(n) : (py(k) + py(k + 1)) / 2
      const ret = retAt(k)
      if (ret > 0.02) {
        ctx.strokeStyle = ink(ret, 0.3)
        ctx.lineWidth = 0.1 + 0.26 * ret
        ctx.beginPath()
        ctx.moveTo(prevMx, prevMy)
        if (last || k === 0) ctx.lineTo(mx, my)
        else ctx.quadraticCurveTo(px(k), py(k), mx, my)
        ctx.stroke()
      }
      prevMx = mx
      prevMy = my
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
    ctx.rotate(p.angle + 0.07 * Math.sin(p.clock * 1.8) * idle)

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
