import { MeshBatch, VERTEX_STRIDE } from './batch'
import { GlRenderer } from './gl'
import { bilinearSample } from '../sim/fluid'
import type { EngineHandle } from '../wasm/engine'
import type { Tracers } from '../sim/particles'
import type { Clouds } from '../sim/clouds'
import { fadeRetention, TRAIL_FADE_T, type Trail } from '../sim/trail'
import { PLANE_LOCAL } from '../sim/bodies'
import type { Vec2 } from '../sim/types'
import type { LevelSimulation } from '../game/simulation'
import { fanDirection } from '../game/simulation'
import { GOAL_LIFT, LONG_PRESS_MS, type PressVisual } from '../sim/types'

export interface SceneState {
  sim: LevelSimulation
  tracers: Tracers
  clouds: Clouds
  planeTrail: Trail
  press: PressVisual | null
  now: number
}

type RGB = readonly [number, number, number]

// 轨迹尾段渐变：靠近起点的采样点线性减淡（头实尾虚）
const tailFade = (k: number, segs: number) => (k < segs ? k / segs : 1)

// 颜色线性插值（drawTracers 5 处 lerp 共用；模块级无闭包，每帧零开销）
const mix = (a: number, b: number, t: number) => a + (b - a) * t

// 云的单个凸起盘（底盘外的装饰凸起；与底盘同色渐变，交叠处无缝）
const cloudPuff = (
  b: MeshBatch, x: number, y: number, r: number,
  fx: number, fy: number, fr: number, segs: number, sf: number, a: number,
) => b.discGradCore(x + fx * r, y + fy * r, fr * r, segs, sf, ...CLOUD, a, ...CLOUD, 0)

// 飞机轮廓遍历序（每帧复用，避免数组分配）
const PLANE_OUTLINE = [0, 1, 2, 3, 0] as const

const rgb = (r: number, g: number, b: number): RGB => [r / 255, g / 255, b / 255]

const HOT = rgb(255, 90, 60)
const COLD = rgb(61, 139, 255)
const FLAME_OUTER = rgb(255, 138, 62)
const FLAME_INNER = rgb(255, 215, 130)
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
const CLOUD = rgb(255, 255, 254)
const CLOUD_SOLID_FRAC = 0.75
const CLOUD_CORE_MIN = 0.15

const SUN_POS = { x: 12, y: 9.5 }
const SUN_RADIUS = 4
const SUN_BREATH_AMP = 0.12
const SUN_BREATH_PERIOD = 700

const AIR_AMBIENT = rgb(200, 197, 183)
const AIR_SOFT = 0.35
const HEAD_ALPHA_AMBIENT = 0.45
const HEAD_ALPHA_STRONG = 0.85
const LINE_ALPHA_AMBIENT = 0.18
const LINE_ALPHA_COLORED = 0.42
const TRACER_LINE_WIDTH = 0.3
const TRACER_HEAD_RADIUS = 0.3
// 拖尾尾端空间淡出段数（采样距 × 段数 = 淡出长度）：保证最旧端 alpha 恒为 0，
// 避免缓冲写满/时间淡出未尽时线段末端出现可见切口
const TRACER_TAIL_SEGS = 5
const PLANE_TRAIL_TAIL_SEGS = 8
const PLANE_TRAIL_WIDTH = 0.36
const GUST_BASE = 0.7
const GUST_BOOST = 0.6
const GUST_FULL_SPEED = 4
const VISIBLE_ALPHA = 0.02
const SOURCE_POP_RATE = 9
const SOURCE_GLOW_RADIUS = 4.8
const SOURCE_CORE_RADIUS = 1.15
const FAN_HOUSING_RADIUS = 1.5
const FAN_FACE_RADIUS = 1.05
const FAN_BLADE_LEN = 0.95
const FAN_BLADE_WIDTH = 0.3
const FAN_SPIN_RATE = 8
// 叶盘 3D 圆投影的短轴/长轴比（长轴 ⊥ dir）：玩家视角 ≈ 进气侧，圆盘投影为椭圆
const FAN_ELLIPSE_K = 0.5
const FLAG_RESPONSE_BASE = 1.2
const FLAG_RESPONSE_WIND = 3
const POLE_HEIGHT = 5.7
const POLE_W = 0.34
const POLE_FABRIC_LEN = 1.8
const SLEEVE_W = 0.4
// 套筒长 = 旗面长 + 杆半径：顶/底帽尖对称超出旗面上下边各 POLE_W/2（底帽尖半径另占去 sr）
const SLEEVE_LEN = POLE_FABRIC_LEN + POLE_W / 2 - SLEEVE_W / 2

const TERRAIN_STEP = 0.25
const TERRAIN_MAX_STEP = 2
// 弦中点-曲线偏差容差（弦偏差自适应采样）：曲线在段内弓起超过此值即加密发射——
// 陡坡上小角度误差×长弦=巨大垂直偏差（旧"角度变化"判据在 L4 转角偏差达 1.5 单位）
const TERRAIN_DEV_TOL = 0.02

// 影子：机身轮廓的垂直投影——沿地表采样暗色折线（贴地形、永不探出地表，高空仍可见）；
// 两端圆盘收圆
const SHADOW_SAMPLES = 5
const SHADOW_W = 0.4
const SHADOW_MAX_ALPHA = 0.3
const SHADOW_FADE = 0.004

export class Renderer {
  readonly canvas: HTMLCanvasElement
  private gl: GlRenderer | null
  private engine: EngineHandle
  private batch: MeshBatch
  // 零拷贝流体场视图（共享引擎内存）：按关卡网格尺寸建一次，视图恒定
  private fields: { u: Float32Array; v: Float32Array; t: Float32Array; nx: number; ny: number; cell: number } | null = null
  private cssW = 0
  private cssH = 0
  private scale = 1
  private ox = 0
  private oy = 0
  private terrainPts = new Float32Array(256)
  private tracerEnv = new Float32Array(0)
  private tracerColor = new Float32Array(0)
  private bgDirty = true
  lastVertexCount = 0
  lastUploadBytes = 0

  constructor(canvas: HTMLCanvasElement, engine: EngineHandle) {
    this.canvas = canvas
    this.engine = engine
    this.batch = new MeshBatch(engine)
    this.gl = GlRenderer.create(canvas)
    if (!this.gl) console.warn('WebGL 不可用，画布将保持空白')
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.cssW = cssW
    this.cssH = cssH
    // dpr 体现在帧缓冲尺寸上：GL viewport 直接用 canvas 设备像素尺寸
    this.canvas.width = Math.max(1, Math.round(cssW * dpr))
    this.canvas.height = Math.max(1, Math.round(cssH * dpr))
    this.gl?.resizeBg()
    this.bgDirty = true
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
    if (!gl || this.cssW === 0 || this.cssH === 0) return
    const { sim, tracers, planeTrail, press, now } = scene
    const { w, h, cell } = sim.level.world
    this.world = sim.level.world
    this.ensureFields(Math.round(w / cell), Math.round(h / cell), cell)

    this.scale = Math.min(this.cssW / w, this.cssH / h)
    this.ox = (this.cssW - w * this.scale) / 2
    this.oy = (this.cssH - h * this.scale) / 2
    const viewL = -this.ox / this.scale
    const viewT = -this.oy / this.scale
    const viewR = viewL + this.cssW / this.scale
    const viewB = viewT + this.cssH / this.scale

    // resize/上下文重置会清空背景纹理：纹理缺失也强制重烘焙补帧（自愈）
    if (this.bgDirty || gl.bgStale || !gl.bgReady) {
      const bg = this.batch
      bg.reset()
      this.drawSky(bg, viewL, viewT, viewR, viewB, h)
      if (gl.bakeBg(bg, viewL, viewT, viewR, viewB)) {
        this.bgDirty = false
        gl.bgStale = false
      }
    }

    const b = this.batch
    b.reset()
    // 遮挡契约（远→近）：天空烘焙进背景纹理（一次不透明 blit 最底）→ 太阳光晕 → 气流粒子与轨迹 →
    // 太阳盘面 → 云（遮粒子与日芒）→ 地形填充（盖掉云的山体内部分，云被山体精确遮挡）→
    // 旗杆 → 旗面/套筒/抵达圆 → 源 → 飞机拖尾 → 飞机
    this.drawSunHalo(b)
    this.drawTracers(b, tracers)
    this.drawSun(b, now)
    this.drawClouds(b, scene.clouds)
    this.drawTerrain(b, sim, viewL, viewR, viewB)
    this.drawGoalPoles(b, sim)
    this.drawGoal(b, sim)
    this.drawFixedSources(b, sim)
    this.drawSources(b, sim, press)
    this.drawFans(b, sim)
    this.drawPlaneTrail(b, sim, planeTrail)
    this.drawPlane(b, sim)
    if (press && press.kind === 'place') this.drawPress(b, press, now)
    this.lastVertexCount = b.count
    this.lastUploadBytes = b.count * VERTEX_STRIDE * 4
    gl.draw(b, viewL, viewT, viewR, viewB)
  }

  private drawSky(b: MeshBatch, viewL: number, viewT: number, viewR: number, viewB: number, h: number) {
    const topBandEnd = Math.min(viewB, 0)
    if (viewT < topBandEnd) b.rect(viewL, viewT, viewR, topBandEnd, ...SKY_TOP, 1)
    const gradTop = Math.max(viewT, 0)
    const gradBottom = Math.min(viewB, h)
    if (gradTop < gradBottom) b.rectVGrad(viewL, gradTop, viewR, gradBottom, ...SKY_TOP, 1, ...SKY_BOTTOM, 1)
    const bottomBandTop = Math.max(viewT, h)
    if (bottomBandTop < viewB) b.rect(viewL, bottomBandTop, viewR, viewB, ...SKY_BOTTOM, 1)
  }

  private drawTerrain(b: MeshBatch, sim: LevelSimulation, viewL: number, viewR: number, viewB: number) {
    const ground = sim.level.ground
    const need = Math.ceil((viewR - viewL) / TERRAIN_STEP + 3) * 2
    if (this.terrainPts.length < need) this.terrainPts = new Float32Array(need)
    const pts = this.terrainPts
    let n = 0
    pts[n++] = viewL
    pts[n++] = ground(viewL)
    let lastX = viewL
    let lastY = pts[n - 1]
    for (let x = Math.max(0, viewL) + TERRAIN_STEP; x <= viewR + 1e-9; x += TERRAIN_STEP) {
      const y = ground(x)
      if (x - lastX >= TERRAIN_MAX_STEP) {
        pts[n++] = x
        pts[n++] = y
        lastX = x
        lastY = y
        continue
      }
      const midX = (lastX + x) / 2
      if (Math.abs(ground(midX) - (lastY + y) / 2) > TERRAIN_DEV_TOL) {
        pts[n++] = x
        pts[n++] = y
        lastX = x
        lastY = y
      }
    }
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
    b.discGrad(SUN_POS.x, SUN_POS.y, SUN_RADIUS * 3, 40, ...SUN, 0.4, ...SUN, 0)
  }

  private drawSun(b: MeshBatch, now: number) {
    const r = SUN_RADIUS + SUN_BREATH_AMP * Math.sin(now / SUN_BREATH_PERIOD)
    b.disc(SUN_POS.x, SUN_POS.y, r, r, 0, 48, ...SUN, 1)
  }

  private drawClouds(b: MeshBatch, clouds: Clouds) {
    for (let i = 0; i < clouds.count; i++) {
      const a = clouds.alpha[i]
      if (a <= VISIBLE_ALPHA) continue
      const x = clouds.x[i]
      const y = clouds.y[i]
      const r = clouds.radius[i]
      const sf = CLOUD_SOLID_FRAC * (CLOUD_CORE_MIN + (1 - CLOUD_CORE_MIN) * a)
      // 一体感：底盘铺满（中心不透明、仅边缘渐隐），凸起全在底盘内叠出轮廓——连接处由底盘兜底，不见接缝
      b.discGradCore(x, y, r, 20, sf, ...CLOUD, a, ...CLOUD, 0)
      cloudPuff(b, x, y, r, -0.95, 0.12, 0.6, 14, sf, a)
      cloudPuff(b, x, y, r, 0.95, 0.1, 0.6, 14, sf, a)
      cloudPuff(b, x, y, r, 0, -0.52, 0.45, 14, sf, a)
      cloudPuff(b, x, y, r, -0.5, 0.62, 0.42, 12, sf, a)
      cloudPuff(b, x, y, r, 0.5, 0.6, 0.4, 12, sf, a)
    }
  }

  private drawGoalPoles(b: MeshBatch, sim: LevelSimulation) {
    for (const g of sim.level.goals) {
      const gy = sim.level.ground(g.x)
      // 底端从 gy - POLE_W/2 起画：圆头帽尖正好落在地面线上（地形填充画在其后，杆身不埋地）
      b.stroke(g.x, gy - POLE_W / 2, g.x, gy - POLE_HEIGHT, POLE_W, ...FLAG_POLE, 1, true)
    }
  }

  private drawGoal(b: MeshBatch, sim: LevelSimulation) {
    const goals = sim.level.goals
    this.ensureFlagState(goals.length)
    for (let i = 0; i < goals.length; i++) {
      const g = goals[i]
      if (sim.visited[i]) continue
      const gy = sim.level.ground(g.x)
      const flagTop = gy - POLE_HEIGHT

      b.dashRing(g.x, gy - GOAL_LIFT, g.r, 1.2, 1.4, 0.28, ...GOAL, 0.32)
      const air = Renderer.tmpAir
      sim.fluid.sampleVelocity(g.x + 1.6, flagTop + 1.4, air)
      const dt = sim.time - this.flagT[i]
      this.flagT[i] = sim.time
      if (dt > 0) {
        const k = 1 - Math.exp(-dt * (FLAG_RESPONSE_BASE + Math.hypot(air.x, air.y) * FLAG_RESPONSE_WIND))
        this.flagX[i] += (air.x - this.flagX[i]) * k
        this.flagY[i] += (air.y - this.flagY[i]) * k
      }
      const sx = this.flagX[i]
      const sy = this.flagY[i]
      const u = Math.hypot(sx, sy)
      const uN = Math.min(1.4, u)
      const len = 0.9 + uN * 2.2
      const dx = u > 0.05 ? sx / u : 0
      const dy = u > 0.05 ? sy / u : 0
      const droop = 0.85 * Math.exp(-uN * 1.6)
      const wave = (0.1 + uN * 0.45) * Math.sin(sim.time * (5 + uN * 4) + i * 1.7)
      const tipX = g.x + dx * len - dy * wave
      const tipY = flagTop + dy * len * 0.55 + droop * len + dx * wave
      b.tri(g.x, flagTop, tipX, tipY, g.x, flagTop + POLE_FABRIC_LEN, ...GOAL, 1)
      // 套筒：纯胶囊（两端圆润），贴杆几乎同粗，静止不随风动，夺旗时与旗面一同消失
      // 顶帽尖在 flagTop - POLE_W/2：正好盖住旗杆圆头帽尖（杆帽伸出杆身 POLE_W/2）；
      // 底帽尖在 flagTop + POLE_FABRIC_LEN + POLE_W/2：与顶侧对称，帽尖距旗面上下边同为 POLE_W/2
      const sr = SLEEVE_W / 2
      b.stroke(g.x, flagTop - POLE_W / 2 + sr, g.x, flagTop + SLEEVE_LEN, SLEEVE_W, ...GOAL, 1, true)
    }
  }

  private flagX = new Float32Array(0)
  private flagY = new Float32Array(0)
  private flagT = new Float32Array(0)
  private trailPts = new Float32Array(0)
  private trailFade = new Float32Array(0)

  private ensureFlagState(n: number) {
    if (this.flagX.length >= n) return
    this.flagX = new Float32Array(n)
    this.flagY = new Float32Array(n)
    this.flagT = new Float32Array(n)
    this.flagT.fill(-Infinity)
  }

  // 固定源形象化（#29）：热源 = 篝火（圆润泪滴火苗 + 底座），冷源 = 空调（圆角机身 + 圆环出风口）——封闭圆润、简约优雅，不复用玩家源圆盘样式
  private drawFixedSources(b: MeshBatch, sim: LevelSimulation) {
    for (const s of sim.fixedSources) {
      if (s.kind === 'hot') this.drawCampfire(b, sim, s.x, s.y)
      else this.drawAC(b, s.x, s.y)
    }
  }

  // 尺寸/形象/动画与功率无关（power 只影响注入热量），避免"改个功率道具忽大忽小"
  private drawCampfire(b: MeshBatch, sim: LevelSimulation, x: number, y: number) {
    b.discGrad(x, y, 2.2, 16, ...HOT, 0.16, ...HOT, 0)
    // 底座：一块圆润坐垫
    b.disc(x, y + 0.1, 1.3, 0.45, 0, 16, ...INK_DARK, 0.28)
    // 火苗：圆头圆尾的泪滴（外橙内黄），摇曳轻微缩放
    const flicker = 1 + 0.12 * Math.sin(sim.time * 9) + 0.06 * Math.sin(sim.time * 15.7 + 1.3)
    b.stroke(x, y - 0.2 * flicker, x, y - 1.2 * flicker, 0.9 * flicker, ...FLAME_OUTER, 0.95, true)
    b.stroke(x, y - 0.2 * flicker, x, y - 0.85 * flicker, 0.5 * flicker, ...FLAME_INNER, 1, true)
  }

  private drawAC(b: MeshBatch, x: number, y: number) {
    const hw = 1.5
    const hh = 0.8
    // 冷光（含蓄）
    b.discGrad(x, y, 2.4, 16, ...COLD, 0.14, ...COLD, 0)
    // 圆角机身：白底 + 四角圆盘（角半径 = hh，全圆角）
    b.rect(x - hw, y - hh, x + hw, y + hh, ...PAPER, 1)
    for (const [cx, cy] of [[-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]] as const) {
      b.disc(x + cx, y + cy, hh, hh, 0, 16, ...PAPER, 1)
    }
    // 圆形出风口：同心圆环
    b.ring(x, y, 0.85, 0.85, 0, 20, 0.18, ...INK_DARK, 0.38)
    b.ring(x, y, 0.55, 0.55, 0, 20, 0.15, ...INK_DARK, 0.28)
    // 指示灯
    b.disc(x, y, 0.2, 0.2, 0, 10, ...COLD, 0.9)
  }

  private drawSources(b: MeshBatch, sim: LevelSimulation, press: PressVisual | null) {
    for (const s of sim.sources) {
      const grabbed = press?.kind === 'remove' && press.sourceId === s.id
      const pop = Math.max(0, 1 - Math.exp(-(sim.time - s.born) * SOURCE_POP_RATE))
      const pulse = 1 + 0.05 * Math.sin(sim.time * 4 + s.id * 1.7)
      const c = s.kind === 'hot' ? HOT : COLD

      if (pop > VISIBLE_ALPHA) {
        b.discGrad(s.x, s.y, SOURCE_GLOW_RADIUS * pop, 24, ...c, 0.32, ...c, 0)
      }

      const coreR = SOURCE_CORE_RADIUS * pop * pulse * (grabbed ? 1.18 : 1)
      b.disc(s.x, s.y, coreR, coreR, 0, 24, ...PAPER, 1)
      b.ring(s.x, s.y, coreR, coreR, 0, 24, 0.34, ...c, 0.9)
      b.disc(s.x, s.y, 0.42 * pop, 0.42 * pop, 0, 16, ...c, 0.95)

      if (grabbed) b.dashRing(s.x, s.y, 2.2, 0.9, 1.1, 0.24, ...INK_DARK, 0.55)
    }
  }

  private drawFans(b: MeshBatch, sim: LevelSimulation) {
    for (const f of sim.fans) {
      const dir = fanDirection(f, sim.time)
      const cd = Math.cos(dir)
      const sd = Math.sin(dir)
      // 叶盘 3D 圆投影为椭圆：长轴 ⊥ dir、短轴沿 dir（短/长 = FAN_ELLIPSE_K）。
      // 玩家视角 ≈ 进气侧（-dir），φ 递增 = 画布顺时针（真实风扇进气面旋转方向）
      const rot = dir + Math.PI / 2
      b.disc(f.x, f.y, FAN_HOUSING_RADIUS, FAN_HOUSING_RADIUS * FAN_ELLIPSE_K, rot, 24, ...INK_DARK, 0.18)
      b.disc(f.x, f.y, FAN_FACE_RADIUS, FAN_FACE_RADIUS * FAN_ELLIPSE_K, rot, 20, ...PAPER, 1)
      // 三片扇叶：中心对称 120° 等分，叶端沿椭圆轨迹（长轴单位 ⊥dir = (-sd, cd)）
      const ax = -sd
      const ay = cd
      for (let k = 0; k < 3; k++) {
        const a = sim.time * FAN_SPIN_RATE + (k * Math.PI * 2) / 3
        const ca = Math.cos(a)
        const sa = Math.sin(a)
        const tx = f.x + FAN_BLADE_LEN * (ca * ax - FAN_ELLIPSE_K * sa * cd)
        const ty = f.y + FAN_BLADE_LEN * (ca * ay - FAN_ELLIPSE_K * sa * sd)
        b.stroke(f.x, f.y, tx, ty, FAN_BLADE_WIDTH, ...INK_DARK, 0.72, true)
      }
      b.ring(f.x, f.y, FAN_FACE_RADIUS, FAN_FACE_RADIUS * FAN_ELLIPSE_K, rot, 20, 0.3, ...INK_DARK, 0.5)
      // 朝向箭头：沿 dir 伸出椭圆短轴端（气流方向即箭头指向，摇头风扇整体随朝向摆动）；垂直于 dir 的单位 = (ax, ay)
      const nx = cd * (FAN_HOUSING_RADIUS * FAN_ELLIPSE_K + 0.35)
      const ny = sd * (FAN_HOUSING_RADIUS * FAN_ELLIPSE_K + 0.35)
      b.tri(
        f.x + nx + ax * 0.28, f.y + ny + ay * 0.28,
        f.x + nx - ax * 0.28, f.y + ny - ay * 0.28,
        f.x + nx * 1.55, f.y + ny * 1.55,
        ...INK_DARK, 0.55,
      )
    }
  }

  private static tmpAir = { x: 0, y: 0 }

  private ensureFields(nx: number, ny: number, cell: number) {
    const f = this.fields
    if (f && f.nx === nx && f.ny === ny && f.cell === cell) return
    const buf = this.engine.memory.buffer
    const n = nx * ny
    this.fields = {
      u: new Float32Array(buf, this.engine.ex.fieldU(), n),
      v: new Float32Array(buf, this.engine.ex.fieldV(), n),
      t: new Float32Array(buf, this.engine.ex.fieldT(), n),
      nx,
      ny,
      cell,
    }
  }

  private drawTracers(b: MeshBatch, tracers: Tracers) {
    const { trailX, trailY, trailT, trailN, count } = tracers
    const trailLen = tracers.trailLen
    const air = Renderer.tmpAir
    const f = this.fields!
    const amb = this.engine.ambient
    if (this.tracerEnv.length < count) {
      this.tracerEnv = new Float32Array(count)
      this.tracerColor = new Float32Array(count * 5)
    }
    const envs = this.tracerEnv
    const colors = this.tracerColor

    for (let i = 0; i < count; i++) {
      const env = tracers.envelope(i)
      if (env <= VISIBLE_ALPHA) {
        envs[i] = 0
        continue
      }
      // 零拷贝采样：直读共享内存流体场（原每粒子 2 次 wasm 跨边界调用）
      const temp = bilinearSample(f.u, f.v, f.t, f.nx, f.ny, f.cell, amb.x, amb.y, tracers.x[i], tracers.y[i], air)
      const sp2 = air.x * air.x + air.y * air.y
      envs[i] = env
      const u = Math.tanh(Math.abs(temp) / AIR_SOFT)
      const to = temp >= 0 ? HOT : COLD
      const c0 = i * 5
      colors[c0] = mix(AIR_AMBIENT[0], to[0], u)
      colors[c0 + 1] = mix(AIR_AMBIENT[1], to[1], u)
      colors[c0 + 2] = mix(AIR_AMBIENT[2], to[2], u)
      colors[c0 + 3] = mix(HEAD_ALPHA_AMBIENT, HEAD_ALPHA_STRONG, u)
      colors[c0 + 4] = mix(LINE_ALPHA_AMBIENT, LINE_ALPHA_COLORED, u)

      const n = trailN[i]
      if (n === 0) continue
      const gust = GUST_BASE + GUST_BOOST * Math.min(1, Math.sqrt(sp2) / GUST_FULL_SPEED)
      const base = i * trailLen
      const now = tracers.time
      const np = n + 1
      if (this.trailPts.length < np * 2) {
        this.trailPts = new Float32Array(np * 2)
        this.trailFade = new Float32Array(np)
      }
      const pts = this.trailPts
      const fade = this.trailFade
      for (let k = 0; k < n; k++) {
        pts[k * 2] = trailX[base + k]
        pts[k * 2 + 1] = trailY[base + k]
        // trailT 以 tracers.time（sim 时间）写入，淡出用同钟读，避免倍速下与 wall clock 漂移
        const a = fadeRetention(now, trailT[base + k], TRAIL_FADE_T) * env * gust
        const tail = tailFade(k, TRACER_TAIL_SEGS)
        fade[k] = a > 0 ? Math.min(1, a) * colors[c0 + 4] * tail : 0
      }
      pts[n * 2] = tracers.x[i]
      pts[n * 2 + 1] = tracers.y[i]
      fade[n] = colors[c0 + 3] * env
      b.polylineFade(pts, np * 2, TRACER_LINE_WIDTH, colors[c0], colors[c0 + 1], colors[c0 + 2], fade)
    }

    for (let i = 0; i < count; i++) {
      const env = envs[i]
      if (env <= 0) continue
      const c0 = i * 5
      b.disc(
        tracers.x[i], tracers.y[i],
        TRACER_HEAD_RADIUS, TRACER_HEAD_RADIUS, 0, 10,
        colors[c0], colors[c0 + 1], colors[c0 + 2], colors[c0 + 3] * env,
      )
    }
  }

  private drawPlaneTrail(b: MeshBatch, sim: LevelSimulation, trail: Trail) {
    const n = trail.count
    if (n === 0) return
    const p = sim.plane
    let px = trail.xAt(0)
    let py = trail.yAt(0)
    for (let k = 0; k < n; k++) {
      const nx = k + 1 < n ? trail.xAt(k + 1) : p.x
      const ny = k + 1 < n ? trail.yAt(k + 1) : p.y
      const f = Math.min(trail.retentionAt(k), tailFade(k, PLANE_TRAIL_TAIL_SEGS))
      if (f > VISIBLE_ALPHA) {
        b.stroke(px, py, nx, ny, PLANE_TRAIL_WIDTH, TRAIL_INK[0], TRAIL_INK[1], TRAIL_INK[2], 0.5 * f)
      }
      px = nx
      py = ny
    }
  }

  private static readonly PLANE_LOCAL = PLANE_LOCAL
  private planeWorld = new Float32Array(8)
  private shadowPts = new Float32Array(SHADOW_SAMPLES * 2)
  // 纸面弯曲（数据驱动 flutter）：机头/机尾沿机身采样风速差，取代旧的 sin(clock) 假抖动
  private static readonly SHEAR_HALF = 1.2
  private static readonly SHEAR_BEND_K = 0.22
  private static readonly SHEAR_BEND_MAX = 0.3
  private planeShear = { x: 0, y: 0 }

  private planeBend(sim: LevelSimulation): number {
    const f = this.fields
    if (!f) return 0
    const p = sim.plane
    const ca = Math.cos(p.angle)
    const sa = Math.sin(p.angle)
    const air = this.planeShear
    const amb = this.engine.ambient
    bilinearSample(f.u, f.v, f.t, f.nx, f.ny, f.cell, amb.x, amb.y, p.x + Renderer.SHEAR_HALF * ca, p.y + Renderer.SHEAR_HALF * sa, air)
    const hx = air.x
    const hy = air.y
    bilinearSample(f.u, f.v, f.t, f.nx, f.ny, f.cell, amb.x, amb.y, p.x - Renderer.SHEAR_HALF * ca, p.y - Renderer.SHEAR_HALF * sa, air)
    const shear = (hx - air.x) * ca + (hy - air.y) * sa
    return Math.max(-Renderer.SHEAR_BEND_MAX, Math.min(Renderer.SHEAR_BEND_MAX, shear * Renderer.SHEAR_BEND_K))
  }

  private drawPlane(b: MeshBatch, sim: LevelSimulation) {
    const p = sim.plane
    const pitch = Math.max(-0.32, Math.min(0.32, p.vy * 0.1))
    const rot = p.angle + pitch
    const cos = Math.cos(rot)
    const sin = Math.sin(rot)
    const w = this.planeWorld
    let minX = Infinity
    let maxX = -Infinity
    for (let i = 0; i < 4; i++) {
      const [lx, ly] = Renderer.PLANE_LOCAL[i]
      w[i * 2] = p.x + lx * cos - ly * sin
      w[i * 2 + 1] = p.y + lx * sin + ly * cos
      if (w[i * 2] < minX) minX = w[i * 2]
      if (w[i * 2] > maxX) maxX = w[i * 2]
    }
    // 影子 = 机身轮廓的垂直投影：采样范围取顶点 x 跨度，陡坡上不沿坡面"飘"到机身之上
    const alt = sim.level.ground(p.x) - p.y
    const shA = SHADOW_MAX_ALPHA - alt * SHADOW_FADE
    if (shA > 0) {
      const pts = this.shadowPts
      const halfW = SHADOW_W / 2
      for (let k = 0; k < SHADOW_SAMPLES; k++) {
        const sx = minX + ((maxX - minX) * k) / (SHADOW_SAMPLES - 1)
        pts[k * 2] = sx
        pts[k * 2 + 1] = sim.level.ground(sx)
      }
      b.polyline(pts, SHADOW_SAMPLES * 2, SHADOW_W, ...INK_DARK, shA)
      // 两端圆盘收圆（与内核 round stroke 同构：半径 = 线宽一半）
      b.disc(pts[0], pts[1], halfW, halfW, 0, 8, ...INK_DARK, shA)
      b.disc(pts[(SHADOW_SAMPLES - 1) * 2], pts[(SHADOW_SAMPLES - 1) * 2 + 1], halfW, halfW, 0, 8, ...INK_DARK, shA)
    }

    // 机头顶点垂直机身偏移 bend：两三角共享机头与脊柱，折痕沿机身成形
    const bend = this.planeBend(sim)
    w[0] -= bend * sin
    w[1] += bend * cos
    b.tri(w[0], w[1], w[2], w[3], w[4], w[5], ...PAPER, 1)
    b.tri(w[0], w[1], w[4], w[5], w[6], w[7], ...PAPER, 1)
    for (let i = 0; i < 4; i++) {
      const a = PLANE_OUTLINE[i] * 2
      const c = PLANE_OUTLINE[i + 1] * 2
      b.stroke(w[a], w[a + 1], w[c], w[c + 1], 0.16, ...INK_DARK, 0.5, true)
    }
    b.stroke(w[0], w[1], w[4], w[5], 0.12, ...INK_DARK, 0.26)
  }

  private drawPress(b: MeshBatch, press: PressVisual, now: number) {
    const progress = Math.min(1, (now - press.start) / LONG_PRESS_MS)
    b.disc(press.x, press.y, 1.5, 1.5, 0, 24, ...HOT, 0.12)
    b.ring(press.x, press.y, 1.5, 1.5, 0, 24, 0.26, ...HOT, 0.75)
    if (progress > 0.04) {
      b.arc(
        press.x, press.y, 2.2,
        -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2, 24, 0.4,
        ...COLD, 0.9,
      )
    }
  }
}
