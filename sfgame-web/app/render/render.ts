import { MeshBatch, VERTEX_STRIDE } from './batch.ts'
import { GlRenderer } from './gl.ts'
import type { EngineHandle } from '../wasm/engine.ts'
import { CLOUD_COUNT } from '../sim/clouds.ts'
import { fillCloudVerts } from './cloud-batch.ts'
import { fadeRetention, PLANE_TRAIL_FADE } from '../sim/trail.ts'
import { PLANE_LOCAL } from '../sim/bodies.ts'
import type { Vec2 } from '../sim/types.ts'
import { fanDirection } from '../game/simulation.ts'
import { gridAnchor, type Terrain } from '../sim/terrain.ts'
import { worldToGrid } from '../sim/grid.ts'
import { GOAL_LIFT, LONG_PRESS_MS, type PressVisual } from '../sim/types.ts'
import type { FanDef } from '../game/types.ts'
import {
  POLE_HEIGHT, VISIBLE_ALPHA, HOT, COLD,
  type CloudsView, type PlaneTrailView, type GoalView, type SourceView, type TracerBatch,
} from '../sim/worker-protocol.ts'

// 渲染消费的静态场景 + 每帧快照动态字段：来源单一（worker 帧快照），views 为场/示踪逐帧拷贝
export interface RenderView {
  world: { w: number; h: number }
  terrain: Terrain
  time: number
  plane: { x: number; y: number; angle: number }
  sources: SourceView[]
  visited: boolean[]
  goals: GoalView[]
  fixedSources: SourceView[]
  fans: FanDef[]
  tracers: TracerBatch | null
  flags: { x: number; y: number }[]
  ambient: { x: number; y: number; t: number }
  clouds: CloudsView
  planeTrail: PlaneTrailView
}

export interface SceneState {
  view: RenderView
  press: PressVisual | null
  now: number
}

type RGB = readonly [number, number, number]

// 轨迹尾段渐变：靠近起点的采样点线性减淡（头实尾虚）
const tailFade = (k: number, segs: number) => (k < segs ? k / segs : 1)

// 飞机轮廓遍历序（每帧复用，避免数组分配）
const PLANE_OUTLINE = [0, 1, 2, 3, 0] as const

const rgb = (r: number, g: number, b: number): RGB => [r / 255, g / 255, b / 255]

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

const SUN_POS = [12, 9.5] as const
const SUN_RADIUS = 4
const SUN_BREATH_AMP = 0.12
const SUN_BREATH_PERIOD = 700

const TRACER_LINE_WIDTH = 0.3
const TRACER_HEAD_RADIUS = 0.3
const PLANE_TRAIL_TAIL_SEGS = 8
const PLANE_TRAIL_WIDTH = 0.36
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
// 场景揭示：换关首帧起内容层（地形/云/粒子/旗/源/飞机）整体淡入，天空恒定不参与（boot 帧已烘焙）
const REVEAL_MS = 160
const FLAG_RESPONSE_BASE = 1.2
const FLAG_RESPONSE_WIND = 3
// 旗面方向满幅风速：u 以下方向向量线性衰减到 0（连续过零），
// 取代单位方向+硬阈值——阈值处宽约 1 跳变到 0，风向反转时旗面会「啪」地消失再弹出
const FLAG_DIR_FULL = 0.3
const POLE_W = 0.34
const POLE_FABRIC_LEN = 1.8
const SLEEVE_W = 0.4
// 套筒长 = 旗面长 + 杆半径：顶/底帽尖对称超出旗面上下边各 POLE_W/2（底帽尖半径另占去 sr）
const SLEEVE_LEN = POLE_FABRIC_LEN + POLE_W / 2 - SLEEVE_W / 2

export class Renderer {
  readonly canvas: HTMLCanvasElement
  private gl: GlRenderer | null
  private batch: MeshBatch
  private cssW = 0
  private cssH = 0
  private scale = 1
  private ox = 0
  private oy = 0
  // 地形 SDF 场：关卡变化时上传内核一次（marching squares 每帧切等值线），每帧只按视域发范围
  private terrainKey: Terrain | null = null
  // 地形烘焙输出：视域（格索引数值四分量）变化才重烘——数值比较免模板串分配（D4 热路径零分配）
  private ti0 = NaN
  private tj0 = NaN
  private ti1 = NaN
  private tj1 = NaN
  private terrainCount = 0
  private bgDirty = true
  private revealMs: number
  private revealStart = -Infinity
  // 云顶点批（pos2+uv2+alpha+seed × 6 顶点/云）：形状全在片元，宿主只发四边形；容量随 CLOUD_COUNT 单源
  private cloudBuf = new Float32Array(CLOUD_COUNT * 6 * 6)
  lastVertexCount = 0
  lastUploadBytes = 0

  constructor(canvas: HTMLCanvasElement, engine: EngineHandle, revealMs = REVEAL_MS) {
    this.canvas = canvas
    this.batch = new MeshBatch(engine)
    this.revealMs = revealMs
    this.gl = GlRenderer.create(canvas)
    if (!this.gl) console.warn('WebGL 不可用，画布将保持空白')
  }

  // 场景揭示因子：墙钟驱动（与 sim 时钟/暂停/掉帧无关）；换关时 setupTerrain 重置起点
  private reveal(now: number): number {
    if (this.revealMs === 0) return 1
    const t = (now - this.revealStart) / this.revealMs
    if (t <= 0) return 0
    if (t >= 1) return 1
    return t * t * (3 - 2 * t)
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

  // 引导帧：worker 就绪前只画天空+太阳光晕（仅依赖世界尺寸的静态层），
  // 消除"进关黑屏一闪"——背景烘焙与正式帧共用同程序同混合，ready 后无缝衔接
  drawBoot(world: { w: number; h: number }) {
    const gl = this.gl
    if (!gl || this.cssW === 0 || this.cssH === 0) return
    const { w, h } = world
    this.world = world
    this.scale = Math.min(this.cssW / w, this.cssH / h)
    this.ox = (this.cssW - w * this.scale) / 2
    this.oy = (this.cssH - h * this.scale) / 2
    const viewL = -this.ox / this.scale
    const viewT = -this.oy / this.scale
    const viewR = viewL + this.cssW / this.scale
    const viewB = viewT + this.cssH / this.scale
    this.drawBackground(gl, viewL, viewT, viewR, viewB, h)
    this.batch.reset()
    gl.draw(this.batch, viewL, viewT, viewR, viewB, 1)
  }

  draw(scene: SceneState) {
    const gl = this.gl
    if (!gl || this.cssW === 0 || this.cssH === 0) return
    const { view, press, now } = scene
    const { w, h } = view.world
    this.world = view.world

    this.scale = Math.min(this.cssW / w, this.cssH / h)
    this.ox = (this.cssW - w * this.scale) / 2
    this.oy = (this.cssH - h * this.scale) / 2
    const viewL = -this.ox / this.scale
    const viewT = -this.oy / this.scale
    const viewR = viewL + this.cssW / this.scale
    const viewB = viewT + this.cssH / this.scale

    // resize/上下文重置会清空背景纹理：纹理缺失也强制重烘焙补帧（自愈）
    this.drawBackground(gl, viewL, viewT, viewR, viewB, h)

    const b = this.batch
    // 当前无相机（恒全图适配）：烘焙窗口恒等于整图，ti0..tj1 比较只在换关/resize 后成立一次——
    // 四分量比较是"未来加相机"的挂点，非每帧视域剔除
    this.drawTerrainPass(gl, b, view.terrain, viewL, viewT, viewR, viewB, now)
    const reveal = this.reveal(now)

    b.reset()
    // 遮挡契约（远→近）：天空+太阳光晕烘焙进背景纹理（一次不透明 blit 最底）→ 气流粒子与轨迹 →
    // 太阳盘面 → 云（独立 GLSL 趟：遮粒子与日芒）→ 地形固体填充（云被山体精确遮挡）→ 旗杆 →
    // 旗面/套筒/抵达圆 → 固定源/源/风扇 → 飞机拖尾与飞机（画面顶层，不被地形遮挡）→ 按压指示
    this.drawTracers(b, view)
    this.drawSun(b, now)
    const pass1 = b.count
    gl.draw(b, viewL, viewT, viewR, viewB, reveal)
    gl.drawClouds(this.cloudBuf, this.fillClouds(view.clouds), viewL, viewT, viewR, viewB, view.time, reveal)
    gl.drawTerrain(this.terrainCount, viewL, viewT, viewR, viewB, reveal)
    b.reset()
    this.drawGoalPoles(b, view)
    this.drawGoal(b, view)
    this.drawFixedSources(b, view)
    this.drawSources(b, view, press, now)
    this.drawFans(b, view)
    this.drawPlaneTrail(b, view)
    this.drawPlane(b, view)
    if (press && press.kind === 'place') this.drawPress(b, press, now)
    this.lastVertexCount = pass1 + b.count + this.terrainCount
    this.lastUploadBytes = (pass1 + b.count) * VERTEX_STRIDE * 4
    gl.drawBatch(b, viewL, viewT, viewR, viewB, reveal)
  }

  // 背景（天空+太阳光晕）烘焙：光晕完全静态（无 sim.time 依赖）却是动态趟屏占比最大的单项，
  // 并入 FBO 后与逐帧绘制逐像素等价（bakeBg 已开同程序同混合），每帧省 120 顶点上传 + 大屏混合填充
  private drawBackground(gl: GlRenderer, viewL: number, viewT: number, viewR: number, viewB: number, h: number) {
    if (this.bgDirty || gl.bgStale || !gl.bgReady) {
      const bg = this.batch
      bg.reset()
      this.drawSky(bg, viewL, viewT, viewR, viewB, h)
      this.drawSunHalo(bg)
      if (gl.bakeBg(bg, viewL, viewT, viewR, viewB)) {
        this.bgDirty = false
        gl.bgStale = false
      }
    }
  }

  // 地形静态几何：setup（每关）+ bake（场/视域变化才重烘）+ 上传（每次 bake 后）——每帧仅 drawArrays
  private drawTerrainPass(gl: GlRenderer, b: MeshBatch, t: Terrain, viewL: number, viewT: number, viewR: number, viewB: number, now: number) {
    if (t !== this.terrainKey) {
      this.setupTerrain(b, t)
      // 换关：内容层揭示从这里起表（首帧因子 0，内容自天空浮现）
      this.revealStart = now
    }
    const tc = t.cell
    // 格索引映射 = worldToGrid 单源（与 terrain.sample 同式）：烘焙锚点在格心，格 (i,j) 即场采样点
    const ti0 = Math.floor(worldToGrid(viewL, tc, t.originX)) - 1
    const tj0 = Math.floor(worldToGrid(viewT, tc, t.originY)) - 1
    const ti1 = Math.ceil(worldToGrid(viewR, tc, t.originX)) + 1
    const tj1 = Math.ceil(worldToGrid(viewB, tc, t.originY)) + 1
    if (ti0 !== this.ti0 || tj0 !== this.tj0 || ti1 !== this.ti1 || tj1 !== this.tj1) {
      this.terrainCount = b.terrainBake(ti0, tj0, ti1, tj1)
      gl.uploadTerrain(b.terrainData, this.terrainCount)
      this.ti0 = ti0
      this.tj0 = tj0
      this.ti1 = ti1
      this.tj1 = tj1
    }
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

  // SDF 场上传内核（每关一次）：此后 marching squares 在 terrainBake 里切一次 d=0 等值线（静态几何），
  // 每帧仅绘制烘焙输出；配色 = 地表色随入地深度指数渐近混向填充色，采样与物理同源
  private setupTerrain(b: MeshBatch, t: Terrain) {
    // 锚点 = 格心（gridAnchor）：烘焙在格心采样、内核把 field[i,j] 当格点值——对齐后等值线即物理面
    if (!b.terrainSetup(
      t.nx, t.ny, gridAnchor(t.originX, t.cell), gridAnchor(t.originY, t.cell), t.cell,
      GROUND_EDGE[0], GROUND_EDGE[1], GROUND_EDGE[2],
      GROUND_FILL[0], GROUND_FILL[1], GROUND_FILL[2],
      GROUND_DEPTH_LEN,
    )) throw new Error('地形场超出顶点批内核容量')
    b.terrainField.set(t.field)
    this.terrainKey = t
    this.ti0 = NaN
    this.tj0 = NaN
    this.ti1 = NaN
    this.tj1 = NaN
  }

  private drawSunHalo(b: MeshBatch) {
    b.discGrad(SUN_POS[0], SUN_POS[1], SUN_RADIUS * 3, 40, ...SUN, 0.4, ...SUN, 0)
  }

  private drawSun(b: MeshBatch, now: number) {
    const r = SUN_RADIUS + SUN_BREATH_AMP * Math.sin(now / SUN_BREATH_PERIOD)
    b.disc(SUN_POS[0], SUN_POS[1], r, r, 0, 48, ...SUN, 1)
  }

  private fillClouds(clouds: CloudsView): number {
    return fillCloudVerts(clouds, this.cloudBuf)
  }

  private drawGoalPoles(b: MeshBatch, view: RenderView) {
    const goals = view.goals
    for (let i = 0; i < goals.length; i++) {
      const gy = goals[i].anchorY
      // 底端从 gy - POLE_W/2 起画：圆头帽尖正好落在地面线上（地形填充画在其后，杆身不埋地）
      b.stroke(goals[i].x, gy - POLE_W / 2, goals[i].x, gy - POLE_HEIGHT, POLE_W, ...FLAG_POLE, 1, true)
    }
  }

  private drawGoal(b: MeshBatch, view: RenderView) {
    const goals = view.goals
    this.ensureFlagState(goals.length)
    for (let i = 0; i < goals.length; i++) {
      const g = goals[i]
      if (view.visited[i]) continue
      const gy = g.anchorY
      const flagTop = gy - POLE_HEIGHT

      b.dashRing(g.x, gy - GOAL_LIFT, g.r, 1.2, 1.4, 0.28, ...GOAL, 0.32)
      // 旗面风 = worker 预计算（同点同语义，与内核采样同构）
      const f = view.flags[i]
      const air = Renderer.tmpAir
      air.x = f?.x ?? 0
      air.y = f?.y ?? 0
      // 一阶滞后趋近当地风；restart 使 view.time 回退，负 dt 会让 k 变负巨值、
      // 状态逐帧炸到 Inf/NaN 后旗面永久消失（Renderer 跨重置持久）——夹到 0
      const dt = Math.max(0, view.time - this.flagT[i])
      this.flagT[i] = view.time
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
      const wave = (0.1 + uN * 0.45) * Math.sin(view.time * (5 + uN * 4) + i * 1.7)
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
  private drawFixedSources(b: MeshBatch, view: RenderView) {
    for (const s of view.fixedSources) {
      if (s.kind === 'hot') this.drawCampfire(b, view, s.x, s.y)
      else this.drawAC(b, s.x, s.y)
    }
  }

  // 尺寸/形象/动画与功率无关（power 只影响注入热量），避免"改个功率道具忽大忽小"
  private drawCampfire(b: MeshBatch, view: RenderView, x: number, y: number) {
    b.discGrad(x, y, 2.2, 16, ...HOT, 0.16, ...HOT, 0)
    // 底座：一块圆润坐垫
    b.disc(x, y + 0.1, 1.3, 0.45, 0, 16, ...INK_DARK, 0.28)
    // 火苗：圆头圆尾的泪滴（外橙内黄），摇曳轻微缩放
    const flicker = 1 + 0.12 * Math.sin(view.time * 9) + 0.06 * Math.sin(view.time * 15.7 + 1.3)
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

  private drawSources(b: MeshBatch, view: RenderView, press: PressVisual | null, now: number) {
    for (const s of view.sources) {
      const grabbed = press?.kind === 'remove' && press.sourceId === s.id
      // 生长动画按墙钟推进：暂停/冻结时 sim 时钟不走，born 差值恒 0 会隐形
      const pop = Math.max(0, 1 - Math.exp(-(now - s.wallBorn) * SOURCE_POP_RATE))
      const pulse = 1 + 0.05 * Math.sin(view.time * 4 + s.id * 1.7)
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

  private drawFans(b: MeshBatch, view: RenderView) {
    for (const f of view.fans) {
      const dir = fanDirection(f, view.time)
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
        const a = view.time * FAN_SPIN_RATE + (k * Math.PI * 2) / 3
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

  private drawTracers(b: MeshBatch, view: RenderView) {
    const td = view.tracers
    if (!td || td.count === 0) return
    // 渲染批由 worker 预计算（同内核记录布局），主线程直拷入顶点批后单调用细分
    b.tracerData.set(td.data)
    b.tracers(td.count, TRACER_LINE_WIDTH, TRACER_HEAD_RADIUS)
  }

  // 拖尾scratch：逐点坐标与 alpha（含追加的飞机位点），生命周期内只增不缩，每帧零分配
  private trailPts = new Float32Array(0)
  private trailFade = new Float32Array(0)

  // 单条折线带（miter 接头）+ 逐点线性 alpha：无逐段恒定 alpha 的阶梯突变、无平头接头缺口；
  // 尾端空间淡出与时间淡出取小，最旧端 alpha 恒为 0，消失如融化而非切断
  private drawPlaneTrail(b: MeshBatch, view: RenderView) {
    const trail = view.planeTrail
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
    // 批量遍历：快照数组即 Trail 迭代序（worker 已按回绕序导出），免 xAt/yAt/tAt 取模
    for (let k = 0; k < n; k++) {
      pts[k * 2] = trail.tx[k]
      pts[k * 2 + 1] = trail.ty[k]
      const f = Math.min(fadeRetention(trail.time, trail.tt[k], PLANE_TRAIL_FADE), tailFade(k, PLANE_TRAIL_TAIL_SEGS))
      fade[k] = 0.5 * f
      if (f > VISIBLE_ALPHA) any = true
    }
    if (!any) return
    const p = view.plane
    pts[n * 2] = p.x
    pts[n * 2 + 1] = p.y
    fade[n] = fade[n - 1]
    b.polylineFade(pts, m * 2, PLANE_TRAIL_WIDTH, TRAIL_INK[0], TRAIL_INK[1], TRAIL_INK[2], fade)
  }

  private planeWorld = new Float32Array(8)

  private drawPlane(b: MeshBatch, view: RenderView) {
    const p = view.plane
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
