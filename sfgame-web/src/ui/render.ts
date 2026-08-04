import { MeshBatch } from '../core/batch'
import { GlRenderer } from './gl'
import type { Tracers } from '../sim/particles'
import { TRAIL_FADE } from '../sim/particles'
import type { Trail } from '../sim/trail'
import type { Vec2 } from '../sim/types'
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

/** 颜色统一 0..1 浮点（非预乘 alpha），与着色器逐顶点格式一致 */
type RGB = readonly [number, number, number]

const rgb = (r: number, g: number, b: number): RGB => [r / 255, g / 255, b / 255]

const HOT = rgb(255, 90, 60)
const COLD = rgb(61, 139, 255)
/** 飞机拖尾：深石墨蓝灰（比所有空气线条更深更冷），α 取高以盖过奶油底色 */
const TRAIL_INK = rgb(64, 74, 106)
const INK_DARK = rgb(61, 52, 39)
const GOAL = rgb(47, 191, 113)
const SKY_TOP = rgb(255, 248, 234)
const SKY_BOTTOM = rgb(248, 226, 187)
const GROUND_FILL = rgb(236, 220, 186)
const GROUND_EDGE = rgb(216, 193, 147)
const SUN = rgb(255, 196, 83)
const PAPER = rgb(255, 253, 248)
const FLAG_POLE = rgb(107, 91, 69)

// ---------- 视觉参数（世界单位，关卡 76×56 尺度） ----------

const SUN_POS = { x: 12, y: 9.5 }
const SUN_RADIUS = 4
const SUN_BREATH_AMP = 0.12
const SUN_BREATH_PERIOD = 700

const TEMP_LEVELS = 5
/** 温度归一化基准：实测四源解粒子温度 p95≈5.3，取 5 定"赤热"满饱和档 */
const T_REF = 5
const LINE_COLORS: RGB[] = [
  rgb(61, 139, 255),
  rgb(116, 154, 208),
  rgb(170, 168, 160),
  rgb(212, 129, 110),
  rgb(255, 90, 60),
]
/** 头部点不透明度按档递减：自然温度最透（半透明浅灰），冷热端更实 */
const HEAD_ALPHA = [0.8, 0.65, 0.45, 0.65, 0.85]
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

/** 地形采样：基础步长；平坦段最大合并间距；相邻段转角阈值（弧度，≈1.1°） */
const TERRAIN_STEP = 0.25
const TERRAIN_MAX_STEP = 2
const TERRAIN_ANG_TOL = 0.02

/** 飞机阴影：顶光垂直投影（光从 12 点方向直照到 6 点方向）——
 * 影子即飞机在地面的竖直投影（同 x），随坡度旋转贴合地形，任意高度可见 */
const SHADOW_RADIUS = 1.5
const SHADOW_RY = 0.32
const SHADOW_LIFT = 0.12
const SHADOW_MAX_ALPHA = 0.3

/**
 * WebGL 渲染器：极简矢量风，整帧所有图元汇入一个顶点批、一次 draw call。
 * 世界坐标 y 向下；视口按 contain 适配，世界边界外由延伸的天空与大地填充，
 * 竖屏/宽屏下没有"死"留白。
 *
 * 相对 Canvas 2D 实现的差异（性能动因见 docs/issues/#7.md）：
 * - iOS 的 Canvas 2D 为 CPU 栅格化，逐帧上万段描边是瓶颈；GPU 三角形光栅化消解之
 * - 逐顶点颜色替代"按透明度/温度分桶 Path2D"：透明度连续、无分桶近似误差
 * - 线段宽度几何化（GL lineWidth 多平台恒 1）：stroke 展开为四边形
 * - 径向渐变用扇形逐顶点插值，免每帧 createRadialGradient 与精灵位图缓存
 * - 静态背景不再离屏缓存：天空/地形/光晕每帧重建仅数百顶点，GPU 负载可忽略
 */
export class Renderer {
  private canvas: HTMLCanvasElement
  private gl: GlRenderer | null
  private batch = new MeshBatch()
  private cssW = 0
  private cssH = 0
  private scale = 1
  private ox = 0
  private oy = 0
  /** 地形采样点 scratch：自适应采样按需扩容（最坏 = 视口宽 / 基础步长） */
  private terrainPts = new Float32Array(256)
  /** 各粒子本帧包络与温度档：头部绘制免重复采样 */
  private tracerEnv = new Float32Array(0)
  private tracerTemp = new Uint8Array(0)

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.gl = GlRenderer.create(canvas)
    if (!this.gl) console.warn('WebGL 不可用，画布将保持空白')
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.cssW = cssW
    this.cssH = cssH
    // dpr 体现在帧缓冲尺寸上：GL viewport 直接用 canvas 设备像素尺寸
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
    const gl = this.gl
    if (!gl || this.cssW === 0) return
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

    const b = this.batch
    b.reset()
    this.drawSky(b, viewL, viewT, viewR, viewB, h)
    this.drawTerrain(b, sim, viewL, viewR, viewB)
    this.drawSunHalo(b)
    this.drawGoalStatic(b, sim)
    this.drawSun(b, now)
    this.drawGoal(b, sim, now)
    this.drawSources(b, sim, press)
    this.drawTracers(b, sim, tracers)
    this.drawPlaneTrail(b, sim, planeTrail)
    this.drawPlane(b, sim)
    if (press && press.kind === 'place') this.drawPress(b, press, now)
    gl.draw(b, viewL, viewT, viewR, viewB)
  }

  /** 天空渐变锚定世界 0..h；视口超出部分由渐变端色自然延伸 */
  private drawSky(b: MeshBatch, viewL: number, viewT: number, viewR: number, viewB: number, h: number) {
    const topBandEnd = Math.min(viewB, 0)
    if (viewT < topBandEnd) b.rect(viewL, viewT, viewR, topBandEnd, ...SKY_TOP, 1)
    const gradTop = Math.max(viewT, 0)
    const gradBottom = Math.min(viewB, h)
    if (gradTop < gradBottom) b.rectVGrad(viewL, gradTop, viewR, gradBottom, ...SKY_TOP, 1, ...SKY_BOTTOM, 1)
    const bottomBandTop = Math.max(viewT, h)
    if (bottomBandTop < viewB) b.rect(viewL, bottomBandTop, viewR, viewB, ...SKY_BOTTOM, 1)
  }

  /**
   * 地形延伸出世界边界：填满竖屏/宽屏视口。
   * 采样自适应：smoothstep 地形弯曲段每 0.25 单位取点，平坦段合并到 2 单位
   * （转角角度变化超过阈值才加密）——视觉平滑的同时点数更少；
   * 边缘线用斜接折线（batch.polyline），转角处无缝不"断裂"。
   */
  private drawTerrain(b: MeshBatch, sim: LevelSimulation, viewL: number, viewR: number, viewB: number) {
    const ground = sim.level.ground
    // 最坏情况点数 = 视口宽 / 基础步长（含左右延伸端点）
    const need = Math.ceil((viewR - viewL) / TERRAIN_STEP + 3) * 2
    if (this.terrainPts.length < need) this.terrainPts = new Float32Array(need)
    const pts = this.terrainPts
    let n = 0
    pts[n++] = viewL
    pts[n++] = ground(viewL)
    let lastX = viewL
    let lastY = pts[n - 1]
    let lastAng = 0
    let haveAng = false
    for (let x = Math.max(0, viewL) + TERRAIN_STEP; x <= viewR + 1e-9; x += TERRAIN_STEP) {
      const y = ground(x)
      const ang = Math.atan2(y - lastY, x - lastX)
      if (!haveAng || Math.abs(ang - lastAng) > TERRAIN_ANG_TOL || x - lastX >= TERRAIN_MAX_STEP) {
        pts[n++] = x
        pts[n++] = y
        lastX = x
        lastY = y
        lastAng = ang
        haveAng = true
      }
    }
    // 终点对齐视口右缘（末段不足一步时补齐）
    if (viewR - lastX > 1e-6) {
      pts[n++] = viewR
      pts[n++] = ground(viewR)
    }

    for (let i = 0; i + 3 < n; i += 2) {
      const ax = pts[i]
      const ay = pts[i + 1]
      const bx = pts[i + 2]
      const by = pts[i + 3]
      b.tri(ax, ay, bx, by, ax, viewB, ...GROUND_FILL, 1)
      b.tri(bx, by, bx, viewB, ax, viewB, ...GROUND_FILL, 1)
    }
    b.polyline(pts, n, 0.5, ...GROUND_EDGE, 1)
  }

  private drawSunHalo(b: MeshBatch) {
    b.discGrad(SUN_POS.x, SUN_POS.y, SUN_RADIUS * 3, 28, ...SUN, 0.4, ...SUN, 0)
  }

  /** 目标区静态部分：感应虚线圆 + 光柱 */
  private drawGoalStatic(b: MeshBatch, sim: LevelSimulation) {
    const goal = sim.level.goal
    const gy = sim.level.ground(goal.x)
    b.dashRing(goal.x, gy - 2, goal.r, 1.2, 1.4, 0.28, ...GOAL, 0.35)
    b.rectVGrad(goal.x - 1.6, gy - 12, goal.x + 1.6, gy, ...GOAL, 0, ...GOAL, 0.14)
  }

  private drawSun(b: MeshBatch, now: number) {
    const r = SUN_RADIUS + SUN_BREATH_AMP * Math.sin(now / SUN_BREATH_PERIOD)
    b.disc(SUN_POS.x, SUN_POS.y, r, r, 0, 24, ...SUN, 1)
  }

  private drawGoal(b: MeshBatch, sim: LevelSimulation, now: number) {
    const g = sim.level.goal
    const gy = sim.level.ground(g.x)
    const rx = g.r * 0.62 * (1 + 0.06 * Math.sin(now / 320))

    b.disc(g.x, gy - 0.1, rx, 1.0, 0, 24, ...GOAL, 0.3)
    b.ring(g.x, gy - 0.1, rx, 1.0, 0, 24, 0.3, ...GOAL, 0.75)

    // 旗帜：波幅与顺风倾斜随目标处实测风速——风与画面同呼吸
    const air = Renderer.tmpAir
    sim.fluid.sampleVelocity(g.x, gy - 5, air)
    const wind = Math.min(1.4, Math.sqrt(air.x * air.x + air.y * air.y))
    const top = gy - 6
    b.stroke(g.x, gy, g.x, top, 0.34, ...FLAG_POLE, 1)
    const wave = (0.35 + wind * 0.55) * Math.sin(now / 240)
    const lean = 0.1 * wind
    b.tri(g.x, top, g.x + 3.1 + lean, top + 0.9 + wave, g.x, top + 2.1, ...GOAL, 1)
  }

  private drawSources(b: MeshBatch, sim: LevelSimulation, press: PressVisual | null) {
    for (const s of sim.sources) {
      const grabbed = press?.kind === 'remove' && press.sourceId === s.id
      // pop 钳制非负：防任何 future 路径出现 time < born 导致源隐形
      const pop = Math.max(0, 1 - Math.exp(-(sim.time - s.born) * SOURCE_POP_RATE))
      const pulse = 1 + 0.05 * Math.sin(sim.time * 4 + s.id * 1.7)
      const c = s.kind === 'hot' ? HOT : COLD

      if (pop > VISIBLE_ALPHA) {
        b.discGrad(s.x, s.y, SOURCE_GLOW_RADIUS * pop, 20, ...c, 0.32, ...c, 0)
      }

      const coreR = SOURCE_CORE_RADIUS * pop * pulse * (grabbed ? 1.18 : 1)
      b.disc(s.x, s.y, coreR, coreR, 0, 18, ...PAPER, 1)
      b.ring(s.x, s.y, coreR, coreR, 0, 18, 0.34, ...c, 0.9)
      b.disc(s.x, s.y, 0.42 * pop, 0.42 * pop, 0, 12, ...c, 0.95)

      if (grabbed) b.dashRing(s.x, s.y, 2.2, 0.9, 1.1, 0.24, ...INK_DARK, 0.55)
    }
  }

  /** 共享采样临时量：热路径零分配 */
  private static tmpAir = { x: 0, y: 0 }

  /**
   * 风的线条（streakline）+ 头部点。
   * 逐段计算颜色（温度档）与透明度（路程存留 × 生命包络 × 阵风系数），
   * 直接写入顶点——无需 Canvas 2D 时代的两级分桶近似。
   */
  private drawTracers(b: MeshBatch, sim: LevelSimulation, tracers: Tracers) {
    const { trailX, trailY, trailO, trailN, odo, count } = tracers
    const trailLen = tracers.trailLen
    const fluid = sim.fluid
    const air = Renderer.tmpAir
    if (this.tracerEnv.length < count) {
      this.tracerEnv = new Float32Array(count)
      this.tracerTemp = new Uint8Array(count)
    }
    const envs = this.tracerEnv
    const levels = this.tracerTemp

    for (let i = 0; i < count; i++) {
      const env = tracers.envelope(i)
      if (env <= VISIBLE_ALPHA) {
        envs[i] = 0
        continue
      }
      fluid.sampleVelocity(tracers.x[i], tracers.y[i], air)
      const sp2 = air.x * air.x + air.y * air.y
      if (sp2 < CALM_AIR_SPEED2) {
        envs[i] = 0
        continue
      }
      envs[i] = env
      const f = Math.max(-1, Math.min(1, fluid.sampleTemp(tracers.x[i], tracers.y[i]) / T_REF))
      const tl = Math.min(TEMP_LEVELS - 1, ((f + 1) * 2.5) | 0)
      levels[i] = tl

      const n = trailN[i]
      if (n === 0) continue
      const gust = GUST_BASE + GUST_BOOST * Math.min(1, Math.sqrt(sp2) / GUST_FULL_SPEED)
      const c = LINE_COLORS[tl]
      const base = i * trailLen
      const odoI = odo[i]
      let px = trailX[base]
      let py = trailY[base]
      for (let k = 0; k < n; k++) {
        const nx = k + 1 < n ? trailX[base + k + 1] : tracers.x[i]
        const ny = k + 1 < n ? trailY[base + k + 1] : tracers.y[i]
        const a = (1 - (odoI - trailO[base + k]) / TRAIL_FADE) * env * gust
        if (a > VISIBLE_ALPHA) {
          b.stroke(px, py, nx, ny, TRACER_LINE_WIDTH, c[0], c[1], c[2], Math.min(1, a) * LINE_ALPHA_MAX)
        }
        px = nx
        py = ny
      }
    }

    // 头部点在所有线条之后绘制，保证点在线上
    for (let i = 0; i < count; i++) {
      const env = envs[i]
      if (env <= 0) continue
      const tl = levels[i]
      const c = LINE_COLORS[tl]
      b.disc(
        tracers.x[i], tracers.y[i],
        TRACER_HEAD_RADIUS, TRACER_HEAD_RADIUS, 0, 10,
        c[0], c[1], c[2], HEAD_ALPHA[tl] * env,
      )
    }
  }

  /** 纸飞机拖尾：按路程淡出的石墨蓝灰轨迹（停驻时可见），宽度与透明度随存留连续变化 */
  private drawPlaneTrail(b: MeshBatch, sim: LevelSimulation, trail: Trail) {
    const n = trail.count
    if (n === 0) return
    const p = sim.plane
    let px = trail.xAt(0)
    let py = trail.yAt(0)
    for (let k = 0; k < n; k++) {
      const nx = k + 1 < n ? trail.xAt(k + 1) : p.x
      const ny = k + 1 < n ? trail.yAt(k + 1) : p.y
      const ret = trail.retentionAt(k)
      if (ret > VISIBLE_ALPHA) {
        b.stroke(px, py, nx, ny, 0.1 + 0.26 * ret, TRAIL_INK[0], TRAIL_INK[1], TRAIL_INK[2], 0.5 * ret)
      }
      px = nx
      py = ny
    }
  }

  /** 飞机机体局部顶点（未旋转）：机头 / 上翼 / 中折 / 下翼 */
  private static readonly PLANE_LOCAL = [
    [1.85, 0],
    [-1.35, -1.12],
    [-0.6, 0],
    [-1.35, 1.12],
  ] as const
  private planeWorld = new Float32Array(8)

  private drawPlane(b: MeshBatch, sim: LevelSimulation) {
    const p = sim.plane
    // 顶光垂直投影：影子 = 飞机正下方的地面投影（同 x），坡度旋转贴合地形
    const g0 = sim.level.ground(p.x - SHADOW_RADIUS)
    const g1 = sim.level.ground(p.x + SHADOW_RADIUS)
    const slope = Math.atan2(g1 - g0, SHADOW_RADIUS * 2)
    const sy = sim.level.ground(p.x) - SHADOW_LIFT
    b.disc(p.x, sy, SHADOW_RADIUS, SHADOW_RY, slope, 16, ...INK_DARK, SHADOW_MAX_ALPHA)

    const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy)
    const idle = Math.max(0, 1 - speed / 3)
    // 俯仰随垂直速度：下落低头、上升抬头（低速时收拢为待机摆动）
    const pitch = Math.max(-0.32, Math.min(0.32, p.vy * 0.1))
    const rot = p.angle + 0.07 * Math.sin(p.clock * 1.8) * idle + pitch
    const cos = Math.cos(rot)
    const sin = Math.sin(rot)
    const w = this.planeWorld
    for (let i = 0; i < 4; i++) {
      const [lx, ly] = Renderer.PLANE_LOCAL[i]
      w[i * 2] = p.x + lx * cos - ly * sin
      w[i * 2 + 1] = p.y + lx * sin + ly * cos
    }
    // 机体：机头-上翼-中折 / 机头-中折-下翼
    b.tri(w[0], w[1], w[2], w[3], w[4], w[5], ...PAPER, 1)
    b.tri(w[0], w[1], w[4], w[5], w[6], w[7], ...PAPER, 1)
    const outline = [0, 1, 2, 3, 0]
    for (let i = 0; i < 4; i++) {
      const a = outline[i] * 2
      const c = outline[i + 1] * 2
      b.stroke(w[a], w[a + 1], w[c], w[c + 1], 0.16, ...INK_DARK, 0.5)
    }
    b.stroke(w[0], w[1], w[4], w[5], 0.12, ...INK_DARK, 0.26)
  }

  private drawPress(b: MeshBatch, press: PressVisual, now: number) {
    const progress = Math.min(1, (now - press.start) / LONG_PRESS_MS)
    b.disc(press.x, press.y, 1.5, 1.5, 0, 18, ...HOT, 0.12)
    b.ring(press.x, press.y, 1.5, 1.5, 0, 18, 0.26, ...HOT, 0.75)
    if (progress > 0.04) {
      b.arc(
        press.x, press.y, 2.2,
        -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2, 24, 0.4,
        ...COLD, 0.9,
      )
    }
  }
}
