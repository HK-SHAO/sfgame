import { MeshBatch, VERTEX_STRIDE } from './batch.ts'
import { GlRenderer } from './gl.ts'
import { bilinearSample } from '../sim/fluid.ts'
import type { EngineHandle } from '../wasm/engine.ts'
import type { Tracers } from '../sim/particles.ts'
import type { Clouds } from '../sim/clouds.ts'
import { fadeRetention, TRAIL_FADE_T, type Trail } from '../sim/trail.ts'
import { PLANE_LOCAL } from '../sim/bodies.ts'
import type { Vec2 } from '../sim/types.ts'
import type { LevelSimulation } from '../game/simulation.ts'
import { fanDirection } from '../game/simulation.ts'
import type { Terrain } from '../sim/terrain.ts'
import { GOAL_LIFT, LONG_PRESS_MS, type PressVisual } from '../sim/types.ts'

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

// 颜色插值（5 处共用）：模块级无闭包，每帧零开销
const mix = (a: number, b: number, t: number) => a + (b - a) * t

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
// 地表色 = 迁移前描边色：锐利轮廓沿 d=0 等值线，入地按 SDF 深度指数渐近混向原填充色（深度渐变唯一配色）
const GROUND_EDGE = rgb(216, 193, 147)
// 深度渐变特征长度（世界单位）：k = 1−exp(−深度/L)，表面过渡最陡、深处趋缓，视觉柔和自然
const GROUND_DEPTH_LEN = 8
const SUN = rgb(255, 196, 83)
const PAPER = rgb(255, 253, 248)
const FLAG_POLE = rgb(107, 91, 69)

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
// 拖尾尾端空间淡出段数（采样距 × 段数 = 淡出长度）：保证最旧端 alpha 恒为 0，避免线段末端可见切口
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
// 旗面方向满幅风速：u 以下方向向量线性衰减到 0（连续过零），
// 取代单位方向+硬阈值——阈值处宽约 1 跳变到 0，风向反转时旗面会「啪」地消失再弹出
const FLAG_DIR_FULL = 0.3
// 旗杆高：原 5.7 的约 2/3（目标区压低，避免遮挡视线；旗面仍从杆顶垂挂）
const POLE_HEIGHT = 3.8
const POLE_W = 0.34
const POLE_FABRIC_LEN = 1.8
const SLEEVE_W = 0.4
// 套筒长 = 旗面长 + 杆半径：顶/底帽尖对称超出旗面上下边各 POLE_W/2（底帽尖半径另占去 sr）
const SLEEVE_LEN = POLE_FABRIC_LEN + POLE_W / 2 - SLEEVE_W / 2

export class Renderer {
  readonly canvas: HTMLCanvasElement
  private gl: GlRenderer | null
  private engine: EngineHandle
  private batch: MeshBatch
  // 零拷贝流体场视图（共享引擎内存）：按关卡网格尺寸建一次，视图恒定
  private fields: { u: Float32Array; v: Float32Array; t: Float32Array; fxU: Float32Array; fxV: Float32Array; nx: number; ny: number; cell: number } | null = null
  private cssW = 0
  private cssH = 0
  private scale = 1
  private ox = 0
  private oy = 0
  // 地形 SDF 场：关卡变化时上传内核一次（marching squares 每帧切等值线），每帧只按视域发范围
  private terrainKey: Terrain | null = null
  private bgDirty = true
  // 云顶点批（pos2+uv2+alpha+seed × 6 顶点/云）：形状全在片元，宿主只发四边形
  private cloudBuf = new Float32Array(3 * 6 * 6)
  lastVertexCount = 0
  lastUploadBytes = 0

  constructor(canvas: HTMLCanvasElement, engine: EngineHandle) {
    this.canvas = canvas
    this.engine = engine
    this.batch = new MeshBatch(engine)
    this.gl = GlRenderer.create(canvas)
    if (!this.gl) console.warn('WebGL 不可用，画布将保持空白')
  }

  // 渲染可用性：gl 创建失败时由 ui 层告知玩家（画布会保持空白）
  get available(): boolean {
    return this.gl !== null
  }

  // 销毁：GL 资源 + 监听 + 强制释放上下文（每关一个新 context，不显式释放会累积到浏览器活跃上限）
  dispose() {
    this.gl?.destroy()
    this.gl = null
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
    const { w, h } = sim.level.world
    this.world = sim.level.world
    // 场视图尺寸以流体为准（流体域 = 地图外扩边距，大于关卡世界）
    this.ensureFields(sim.fluid.nx, sim.fluid.ny, sim.fluid.cell)

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
    // 太阳盘面 → 云（独立 GLSL 趟：遮粒子与日芒）→ 地形固体填充（云被山体精确遮挡）→ 旗杆 →
    // 旗面/套筒/抵达圆 → 固定源/源/风扇 → 飞机拖尾与飞机（画面顶层，不被地形遮挡）→ 按压指示
    this.drawSunHalo(b)
    this.drawTracers(b, tracers)
    this.drawSun(b, now)
    const pass1 = b.count
    gl.draw(b, viewL, viewT, viewR, viewB)
    gl.drawClouds(this.cloudBuf, this.fillClouds(scene.clouds), viewL, viewT, viewR, viewB, sim.time)
    b.reset()
    this.drawTerrain(b, sim, viewL, viewT, viewR, viewB)
    this.drawGoalPoles(b, sim)
    this.drawGoal(b, sim)
    this.drawFixedSources(b, sim)
    this.drawSources(b, sim, press, now)
    this.drawFans(b, sim)
    this.drawPlaneTrail(b, sim, planeTrail)
    this.drawPlane(b, sim)
    if (press && press.kind === 'place') this.drawPress(b, press, now)
    this.lastVertexCount = pass1 + b.count
    this.lastUploadBytes = (pass1 + b.count) * VERTEX_STRIDE * 4
    gl.drawBatch(b, viewL, viewT, viewR, viewB)
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

  private drawTerrain(b: MeshBatch, sim: LevelSimulation, viewL: number, viewT: number, viewR: number, viewB: number) {
    const t = sim.terrain
    if (t !== this.terrainKey) this.uploadTerrain(b, t)
    // 视域格心索引范围（越界由内核钳场延展）：单调用发当前可见格
    const c = t.cell
    b.terrainDraw(
      Math.floor(viewL / c + t.originX) - 1,
      Math.floor(viewT / c + t.originY) - 1,
      Math.ceil(viewR / c + t.originX) + 1,
      Math.ceil(viewB / c + t.originY) + 1,
    )
  }

  // SDF 场上传内核（每关一次）：绘制端每帧 marching squares 切 d=0 等值线，轮廓矢量级锐利；
  // 配色 = 地表色（旧描边色）随入地深度指数渐近混向原填充色，采样与物理同源
  private uploadTerrain(b: MeshBatch, t: Terrain) {
    if (!b.terrainSetup(
      t.nx, t.ny, -t.originX * t.cell, -t.originY * t.cell, t.cell,
      GROUND_EDGE[0], GROUND_EDGE[1], GROUND_EDGE[2],
      GROUND_FILL[0], GROUND_FILL[1], GROUND_FILL[2],
      GROUND_DEPTH_LEN,
    )) throw new Error('地形场超出顶点批内核容量')
    b.terrainField.set(t.field)
    this.terrainKey = t
  }

  private drawSunHalo(b: MeshBatch) {
    b.discGrad(SUN_POS.x, SUN_POS.y, SUN_RADIUS * 3, 40, ...SUN, 0.4, ...SUN, 0)
  }

  private drawSun(b: MeshBatch, now: number) {
    const r = SUN_RADIUS + SUN_BREATH_AMP * Math.sin(now / SUN_BREATH_PERIOD)
    b.disc(SUN_POS.x, SUN_POS.y, r, r, 0, 48, ...SUN, 1)
  }

  // 每朵云一个四边形（两三角形）：uv 纵轴与世界 y 同向（向下），片元底边压平即积云下沿
  private fillClouds(clouds: Clouds): number {
    const d = this.cloudBuf
    let n = 0
    for (let i = 0; i < clouds.count; i++) {
      const a = clouds.alpha[i]
      if (a <= VISIBLE_ALPHA) continue
      // 四边形 = 可见云体（片元基椭圆约 0.68/0.61 占空）的反算包围盒
      const hw = clouds.radius[i] * 1.5
      const hh = clouds.radius[i] * 1.1
      const x0 = clouds.x[i] - hw
      const y0 = clouds.y[i] - hh
      const x1 = clouds.x[i] + hw
      const y1 = clouds.y[i] + hh
      const s = clouds.seed[i]
      d[n++] = x0; d[n++] = y0; d[n++] = 0; d[n++] = 0; d[n++] = a; d[n++] = s
      d[n++] = x1; d[n++] = y0; d[n++] = 1; d[n++] = 0; d[n++] = a; d[n++] = s
      d[n++] = x0; d[n++] = y1; d[n++] = 0; d[n++] = 1; d[n++] = a; d[n++] = s
      d[n++] = x1; d[n++] = y0; d[n++] = 1; d[n++] = 0; d[n++] = a; d[n++] = s
      d[n++] = x1; d[n++] = y1; d[n++] = 1; d[n++] = 1; d[n++] = a; d[n++] = s
      d[n++] = x0; d[n++] = y1; d[n++] = 0; d[n++] = 1; d[n++] = a; d[n++] = s
    }
    return n / 6
  }

  private drawGoalPoles(b: MeshBatch, sim: LevelSimulation) {
    const goals = sim.level.goals
    for (let i = 0; i < goals.length; i++) {
      const gy = sim.goalGroundY[i]
      // 底端从 gy - POLE_W/2 起画：圆头帽尖正好落在地面线上（地形填充画在其后，杆身不埋地）
      b.stroke(goals[i].x, gy - POLE_W / 2, goals[i].x, gy - POLE_HEIGHT, POLE_W, ...FLAG_POLE, 1, true)
    }
  }

  private drawGoal(b: MeshBatch, sim: LevelSimulation) {
    const goals = sim.level.goals
    this.ensureFlagState(goals.length)
    for (let i = 0; i < goals.length; i++) {
      const g = goals[i]
      if (sim.visited[i]) continue
      const gy = sim.goalGroundY[i]
      const flagTop = gy - POLE_HEIGHT

      b.dashRing(g.x, gy - GOAL_LIFT, g.r, 1.2, 1.4, 0.28, ...GOAL, 0.32)
      const air = Renderer.tmpAir
      sim.fluid.sampleVelocity(g.x + 1.6, flagTop + 1.4, air)
      // 一阶滞后趋近当地风；restart 使 sim.time 回退，负 dt 会让 k 变负巨值、
      // 状态逐帧炸到 Inf/NaN 后旗面永久消失（Renderer 跨重置持久）——夹到 0
      const dt = Math.max(0, sim.time - this.flagT[i])
      this.flagT[i] = sim.time
      const k = 1 - Math.exp(-dt * (FLAG_RESPONSE_BASE + Math.hypot(air.x, air.y) * FLAG_RESPONSE_WIND))
      this.flagX[i] += (air.x - this.flagX[i]) * k
      this.flagY[i] += (air.y - this.flagY[i]) * k
      const sx = this.flagX[i]
      const sy = this.flagY[i]
      const u = Math.hypot(sx, sy)
      const uN = Math.min(1.4, u)
      const len = 0.9 + uN * 2.2
      // 方向向量 = 单位方向 × min(1, u/FULL)：u<FULL 时退化为 sx/FULL，随 sx 线性过零，
      // 旗面宽度连续收拢→反向展开，零点无突跳
      const inv = u > 1e-4 ? Math.min(1, u / FLAG_DIR_FULL) / u : 0
      const dx = sx * inv
      const dy = sy * inv
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

  private drawSources(b: MeshBatch, sim: LevelSimulation, press: PressVisual | null, now: number) {
    for (const s of sim.sources) {
      const grabbed = press?.kind === 'remove' && press.sourceId === s.id
      // 生长动画按墙钟推进：暂停/冻结时 sim 时钟不走，born 差值恒 0 会隐形
      const pop = Math.max(0, 1 - Math.exp(-(now - s.wallBorn) * SOURCE_POP_RATE))
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
      fxU: new Float32Array(buf, this.engine.ex.fieldFxU(), n),
      fxV: new Float32Array(buf, this.engine.ex.fieldFxV(), n),
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
    const org = this.engine.origin
    // 可见粒子直写内核批量缓冲（定长记录），末尾单调用 tessellate：每帧跨界从 ~800 次降到 1 次
    const buf = b.tracerData
    const stride = b.tracerStride
    const cap = b.tracerCap
    const now = tracers.time
    let m = 0
    for (let i = 0; i < count && m < cap; i++) {
      const env = tracers.envelope(i)
      if (env <= VISIBLE_ALPHA) continue
      // 零拷贝采样：直读共享内存流体场（环境风 = 基场×强度，与 wasm 采样同构）；
      // 着色用总温度 = 场温 + 环境偏置（与内核 sampleTemp/浮力同一事实源）
      const temp = bilinearSample(f.u, f.v, f.t, f.fxU, f.fxV, f.nx, f.ny, f.cell, org.x, org.y, amb.x, amb.y, tracers.x[i], tracers.y[i], air) + amb.t
      const sp2 = air.x * air.x + air.y * air.y
      const u = Math.tanh(Math.abs(temp) / AIR_SOFT)
      const to = temp >= 0 ? HOT : COLD
      const cr = mix(AIR_AMBIENT[0], to[0], u)
      const cg = mix(AIR_AMBIENT[1], to[1], u)
      const cb = mix(AIR_AMBIENT[2], to[2], u)
      const headAlpha = mix(HEAD_ALPHA_AMBIENT, HEAD_ALPHA_STRONG, u) * env
      const lineAlpha = mix(LINE_ALPHA_AMBIENT, LINE_ALPHA_COLORED, u)

      const off = m * stride
      buf[off] = cr
      buf[off + 1] = cg
      buf[off + 2] = cb
      buf[off + 4] = headAlpha
      let np = 0
      const n = trailN[i]
      if (n > 0) {
        const gust = GUST_BASE + GUST_BOOST * Math.min(1, Math.sqrt(sp2) / GUST_FULL_SPEED)
        const base = i * trailLen
        for (let k = 0; k < n; k++) {
          const po = off + 5 + np * 3
          buf[po] = trailX[base + k]
          buf[po + 1] = trailY[base + k]
          // trailT 以 tracers.time（sim 时间）写入，淡出用同钟读，避免倍速下与 wall clock 漂移
          const a = fadeRetention(now, trailT[base + k], TRAIL_FADE_T) * env * gust
          const tail = tailFade(k, TRACER_TAIL_SEGS)
          buf[po + 2] = a > 0 ? Math.min(1, a) * lineAlpha * tail : 0
          np++
        }
      }
      const po = off + 5 + np * 3
      buf[po] = tracers.x[i]
      buf[po + 1] = tracers.y[i]
      // 头部顶点 alpha=0：线带恰在头心淡尽，头部圆盘独享混合——避免线带与圆盘重叠区双混发深
      buf[po + 2] = 0
      np++
      buf[off + 3] = np
      m++
    }
    b.tracers(m, TRACER_LINE_WIDTH, TRACER_HEAD_RADIUS)
  }

  // 拖尾scratch：逐点坐标与 alpha（含追加的飞机位点），生命周期内只增不缩，每帧零分配
  private trailPts = new Float32Array(0)
  private trailFade = new Float32Array(0)

  // 单条折线带（miter 接头）+ 逐点线性 alpha：无逐段恒定 alpha 的阶梯突变、无平头接头缺口；
  // 尾端空间淡出与时间淡出取小，最旧端 alpha 恒为 0，消失如融化而非切断
  private drawPlaneTrail(b: MeshBatch, sim: LevelSimulation, trail: Trail) {
    const n = trail.count
    if (n === 0) return
    const m = n + 1
    if (this.trailPts.length < m * 2) {
      this.trailPts = new Float32Array(m * 2)
      this.trailFade = new Float32Array(m)
    }
    const pts = this.trailPts
    const fade = this.trailFade
    let any = false
    for (let k = 0; k < n; k++) {
      pts[k * 2] = trail.xAt(k)
      pts[k * 2 + 1] = trail.yAt(k)
      const f = Math.min(trail.retentionAt(k), tailFade(k, PLANE_TRAIL_TAIL_SEGS))
      fade[k] = 0.5 * f
      if (f > VISIBLE_ALPHA) any = true
    }
    if (!any) return
    const p = sim.plane
    pts[n * 2] = p.x
    pts[n * 2 + 1] = p.y
    fade[n] = fade[n - 1]
    b.polylineFade(pts, m * 2, PLANE_TRAIL_WIDTH, TRAIL_INK[0], TRAIL_INK[1], TRAIL_INK[2], fade)
  }

  private planeWorld = new Float32Array(8)

  private drawPlane(b: MeshBatch, sim: LevelSimulation) {
    const p = sim.plane
    const cos = Math.cos(p.angle)
    const sin = Math.sin(p.angle)
    const w = this.planeWorld
    for (let i = 0; i < 4; i++) {
      const [lx, ly] = PLANE_LOCAL[i]
      w[i * 2] = p.x + lx * cos - ly * sin
      w[i * 2 + 1] = p.y + lx * sin + ly * cos
    }

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
