import { MeshBatch, VERTEX_STRIDE } from '../core/batch'
import { GlRenderer } from './gl'
import type { Tracers } from '../sim/particles'
import { TRAIL_FADE_T } from '../sim/particles'
import type { Clouds } from '../sim/clouds'
import type { Trail } from '../sim/trail'
import type { Vec2 } from '../sim/types'
import type { LevelSimulation } from '../game/simulation'
import { GOAL_LIFT } from '../game/simulation'
import type { PressVisual } from '../game/types'
import { LONG_PRESS_MS } from './input'

export interface SceneState {
  sim: LevelSimulation
  tracers: Tracers
  clouds: Clouds
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
/** 云色：近纯白的雾状白（比奶油底色亮，径向渐变边缘透明） */
const CLOUD = rgb(255, 255, 254)
/** 云实核占比：0.75 → 模糊半径 = 1/4 云径（比 0.5 档再减半） */
const CLOUD_SOLID_FRAC = 0.75
/** 云横向拉伸：左右翼外移倍数，拉出 ~1.7× 高的宽扁云 */
const CLOUD_STRETCH = 1.7
/** 淡出时实核收缩下限系数：α→0 时实核趋零（纯渐变化散），云由内而外消散 */
const CLOUD_CORE_MIN = 0.15

// ---------- 视觉参数（世界单位，关卡 76×56 尺度） ----------

const SUN_POS = { x: 12, y: 9.5 }
const SUN_RADIUS = 4
const SUN_BREATH_AMP = 0.12
const SUN_BREATH_PERIOD = 700

/** 常温气色：暖白浅灰（比奶油底色深半档），风感由透明度与线条密度表达 */
const AIR_AMBIENT = rgb(200, 197, 183)
/** 温度→颜色软饱和（tanh 半宽）：实测空气格 ~92% 温度落在 ±0.5 内，线性映射
 * 会让绝大多数空气呈灰；tanh 使 |t|=半宽 即 76% 饱和、4×半宽 以上满饱和。
 * 半宽 0.35（#11 两轮反馈后收窄）：|t|≥0.22 即有明确冷/暖色，常温色区间
 * （u<0.25）收窄到 |t|<0.09；温度场 p10~p90≈0 的安静分布保证常温区不染色 */
const AIR_SOFT = 0.35
const HEAD_ALPHA_AMBIENT = 0.45
const HEAD_ALPHA_STRONG = 0.85
/** 线条不透明度随饱和度抬高：常温最淡（保留风感而不显灰），冷/热端更实更艳 */
const LINE_ALPHA_AMBIENT = 0.18
const LINE_ALPHA_COLORED = 0.42
const TRACER_LINE_WIDTH = 0.3
const TRACER_HEAD_RADIUS = 0.3
const GUST_BASE = 0.7
const GUST_BOOST = 0.6
const GUST_FULL_SPEED = 4
const VISIBLE_ALPHA = 0.02
const SOURCE_POP_RATE = 9
const SOURCE_GLOW_RADIUS = 4.8
const SOURCE_CORE_RADIUS = 1.15
/** 旗面平滑响应率（1/秒）：常驻基准 + 随风速增强的分量（见 drawGoal） */
const FLAG_RESPONSE_BASE = 1.2
const FLAG_RESPONSE_WIND = 3
/** 旗杆高（地面以上）/ 旗面沿旗杆附着长 / 旗杆沉入地面量（被地形遮挡）；旗面顶与旗杆顶齐平 */
const POLE_HEIGHT = 5.7
const POLE_FABRIC_LEN = 1.8
const POLE_SINK = 0.6

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
 * - 静态背景（天空/旗杆/光晕）烘焙进离屏纹理（仅 resize/上下文恢复后重做），
 *   地形随云移入动态层（山脊要遮挡云），动态层每帧重建
 */
export class Renderer {
  readonly canvas: HTMLCanvasElement
  private gl: GlRenderer | null
  private batch = new MeshBatch()
  private cssW = 0
  private cssH = 0
  private scale = 1
  private ox = 0
  private oy = 0
  /** 地形采样点 scratch：自适应采样按需扩容（最坏 = 视口宽 / 基础步长） */
  private terrainPts = new Float32Array(256)
  /** 各粒子本帧包络与连续色（r,g,b,头部α）：头部绘制与线条共用 */
  private tracerEnv = new Float32Array(0)
  private tracerColor = new Float32Array(0)
  /**
   * 静态背景脏标记：resize（视口/画布尺寸变化）后置 true，下一帧 draw 时
   * 把天空/地形/光晕/目标静态烘焙进离屏纹理。烘焙与运行时共用同一套
   * view 计算（cssW/cssH/scale/ox/oy），保证逐像素一致。
   */
  private bgDirty = true
  /** 上一帧动态层顶点数与上传字节（dev 模式叠加层诊断用） */
  lastVertexCount = 0
  lastUploadBytes = 0

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
    // cssH 也为 0 时 scale=0 会产生 NaN/Inf 视口坐标（还可能在 drawTerrain 分配时抛错）
    if (!gl || this.cssW === 0 || this.cssH === 0) return
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

    // 静态背景（天空/旗杆/光晕）烘焙进离屏纹理，仅 resize 后重做；
    // 旗杆先于地形绘制，杆根沉入地面被遮挡；旗面与虚线圆随站点状态/风变化，
    // 必须留在动态层每帧重建；地形也在动态层（云要被山脊遮挡，见 draw 注释）
    // 纹理缺失也强制进块：兜住纹理指针被清但脏标记未置的路径（自愈）
    if (this.bgDirty || gl.bgStale || !gl.bgReady) {
      const bg = this.batch
      bg.reset()
      this.drawSky(bg, viewL, viewT, viewR, viewB, h)
      this.drawGoalPoles(bg, sim)
      this.drawSunHalo(bg)
      // 烘焙失败（FBO 瞬态不完整/纹理分配失败）必须保留脏标记下帧重试，
      // 否则空纹理/兜底清屏会一直顶到下次 resize/上下文事件
      if (gl.bakeBg(bg, viewL, viewT, viewR, viewB)) {
        this.bgDirty = false
        gl.bgStale = false
      }
    }

    const b = this.batch
    b.reset()
    // 动态层自底向上：云 → 地形 → 太阳 → 站点/源/示踪/飞机——
    // 云被山脊、太阳、飞机遮挡（地形逐帧重建，代价 ~2k 顶点）
    this.drawClouds(b, scene.clouds)
    this.drawTerrain(b, sim, viewL, viewR, viewB)
    this.drawSun(b, now)
    this.drawGoal(b, sim)
    this.drawSources(b, sim, press)
    this.drawTracers(b, sim, tracers)
    this.drawPlaneTrail(b, sim, planeTrail)
    this.drawPlane(b, sim)
    if (press && press.kind === 'place') this.drawPress(b, press, now)
    this.lastVertexCount = b.count
    this.lastUploadBytes = b.count * VERTEX_STRIDE * 4
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
    b.discGrad(SUN_POS.x, SUN_POS.y, SUN_RADIUS * 3, 40, ...SUN, 0.4, ...SUN, 0)
  }

  private drawSun(b: MeshBatch, now: number) {
    const r = SUN_RADIUS + SUN_BREATH_AMP * Math.sin(now / SUN_BREATH_PERIOD)
    b.disc(SUN_POS.x, SUN_POS.y, r, r, 0, 48, ...SUN, 1)
  }

/**
 * 云：主体 + 左右翼 + 顶冠 + 平底，五团"实核+软边"径向渐变圆盘拼接
 * （交叠处自然增密成絮状，无生硬接缝）；透明度由 sim 层淡出包络调制。
 * 单盘 α ≈0.9~1.0：云核实白、边缘渐变留雾状感。
 */
  private drawClouds(b: MeshBatch, clouds: Clouds) {
    for (let i = 0; i < clouds.count; i++) {
      const a = clouds.alpha[i]
      if (a <= VISIBLE_ALPHA) continue
      const x = clouds.x[i]
      const y = clouds.y[i]
      const r = clouds.radius[i]
      // 淡出时实核同步收缩到纯渐变：云由内而外化散，消散更丝滑
      const sf = CLOUD_SOLID_FRAC * (CLOUD_CORE_MIN + (1 - CLOUD_CORE_MIN) * a)
      b.discGradCore(x, y, r, 18, sf, ...CLOUD, 1.0 * a, ...CLOUD, 0)
      b.discGradCore(x - 0.62 * r * CLOUD_STRETCH, y + 0.1 * r, 0.66 * r, 14, sf, ...CLOUD, 0.9 * a, ...CLOUD, 0)
      b.discGradCore(x + 0.62 * r * CLOUD_STRETCH, y + 0.08 * r, 0.66 * r, 14, sf, ...CLOUD, 0.9 * a, ...CLOUD, 0)
      b.discGradCore(x, y - 0.42 * r, 0.5 * r, 14, sf, ...CLOUD, 0.78 * a, ...CLOUD, 0)
      b.discGradCore(x, y + 0.3 * r, 0.46 * r, 14, sf, ...CLOUD, 0.6 * a, ...CLOUD, 0)
    }
  }

  /**
   * 站点视觉（一致性约定）：未抵达 = 虚线圆（抵达范围）+ 旗帜；已抵达 = 只留旗杆。
   * 旗杆静态（两状态同形），烘焙进背景且先于地形绘制——杆根被地面遮挡；
   * 虚线圆圆心 = 检测圆心（GOAL_LIFT 抬升），与 simulation.checkGoals 完全一致。
   * 全杆棕杆：绿色附着段由旗面覆盖（drawGoal 的三角旗面左缘即杆线），
   * 抵达后旗面消失，杆上不再残留绿色段。
   */
  private drawGoalPoles(b: MeshBatch, sim: LevelSimulation) {
    for (const g of sim.level.goals) {
      const gy = sim.level.ground(g.x)
      // round：杆顶圆头（矩形/线段首尾圆润）
      b.stroke(g.x, gy + POLE_SINK, g.x, gy - POLE_HEIGHT, 0.34, ...FLAG_POLE, 1, true)
    }
  }

  private drawGoal(b: MeshBatch, sim: LevelSimulation) {
    const goals = sim.level.goals
    this.ensureFlagState(goals.length)
    for (let i = 0; i < goals.length; i++) {
      const g = goals[i]
      if (sim.visited[i]) continue
      const gy = sim.level.ground(g.x)
      const flagTop = gy - POLE_HEIGHT // 旗面顶不高于旗杆顶

      b.dashRing(g.x, gy - GOAL_LIFT, g.r, 1.2, 1.4, 0.28, ...GOAL, 0.32)
      // 旗面跟随所在位置风，一阶低通平滑（风向改变时缓转不瞬翻）；
      // 拉伸/摆动随风速增强；相位用模拟时钟，物理冻结时旗面静止
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
      const dx = u > 0.05 ? sx / u : 0 // 顺风方向；无风退化为垂挂
      const dy = u > 0.05 ? sy / u : 0
      const droop = 0.85 * Math.exp(-uN * 1.6) // 弱风时重力占优，旗面下垂
      const wave = (0.1 + uN * 0.45) * Math.sin(sim.time * (5 + uN * 4) + i * 1.7)
      // 摆动沿旗面垂直方向：水平风里上下飘，垂直风里左右抖
      const tipX = g.x + dx * len - dy * wave
      const tipY = flagTop + dy * len * 0.55 + droop * len + dx * wave
      b.tri(g.x, flagTop, tipX, tipY, g.x, flagTop + POLE_FABRIC_LEN, ...GOAL, 1)
    }
  }

  /** 每面旗的平滑风矢量（惯性）与上次平滑时刻（按模拟时钟，冻结时 dt=0）。 */
  private flagX = new Float32Array(0)
  private flagY = new Float32Array(0)
  private flagT = new Float32Array(0)
  /** 粒子轨迹折线 scratch：pts（x,y 平铺）+ 逐点透明度（按需扩容，热路径零分配） */
  private trailPts = new Float32Array(0)
  private trailFade = new Float32Array(0)

  private ensureFlagState(n: number) {
    if (this.flagX.length >= n) return
    this.flagX = new Float32Array(n)
    this.flagY = new Float32Array(n)
    this.flagT = new Float32Array(n)
    this.flagT.fill(-Infinity) // 首帧 dt=∞ → 立即吸附当前风，再进入平滑
  }

  private drawSources(b: MeshBatch, sim: LevelSimulation, press: PressVisual | null) {
    for (const s of sim.sources) {
      const grabbed = press?.kind === 'remove' && press.sourceId === s.id
      // pop 钳制非负：防任何 future 路径出现 time < born 导致源隐形
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

  /** 共享采样临时量：热路径零分配 */
  private static tmpAir = { x: 0, y: 0 }

  /**
   * 风的线条（streakline）+ 头部点。
   * 逐段计算颜色（温度→tanh 软饱和连续映射）与透明度（时间存留 × 生命包络 × 阵风系数），
   * 直接写入顶点——连续色取代分档，常温与冷/热一望可分（统计依据见 #11）。
   */
  private drawTracers(b: MeshBatch, sim: LevelSimulation, tracers: Tracers) {
    const { trailX, trailY, trailT, trailN, count } = tracers
    const trailLen = tracers.trailLen
    const fluid = sim.fluid
    const air = Renderer.tmpAir
    if (this.tracerEnv.length < count) {
      this.tracerEnv = new Float32Array(count)
      // 每粒子 5 浮点：r,g,b + 头部α + 线条α上限（连续色，免每段重算）
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
      fluid.sampleVelocity(tracers.x[i], tracers.y[i], air)
      const sp2 = air.x * air.x + air.y * air.y
      envs[i] = env
      const t = fluid.sampleTemp(tracers.x[i], tracers.y[i])
      const u = Math.tanh(Math.abs(t) / AIR_SOFT)
      const to = t >= 0 ? HOT : COLD
      const c0 = i * 5
      colors[c0] = AIR_AMBIENT[0] + (to[0] - AIR_AMBIENT[0]) * u
      colors[c0 + 1] = AIR_AMBIENT[1] + (to[1] - AIR_AMBIENT[1]) * u
      colors[c0 + 2] = AIR_AMBIENT[2] + (to[2] - AIR_AMBIENT[2]) * u
      colors[c0 + 3] = HEAD_ALPHA_AMBIENT + (HEAD_ALPHA_STRONG - HEAD_ALPHA_AMBIENT) * u
      colors[c0 + 4] = LINE_ALPHA_AMBIENT + (LINE_ALPHA_COLORED - LINE_ALPHA_AMBIENT) * u

      const n = trailN[i]
      if (n === 0) continue
      // 整条轨迹一条斜接折线（转角无缝）+ 逐顶点时间淡出 + 头部圆帽：
      // 告别逐段平头四边形的"链条/折线"感（顶点 alpha 插值让淡出同样连续）
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
        const a = (1 - (now - trailT[base + k]) / TRAIL_FADE_T) * env * gust
        fade[k] = a > 0 ? Math.min(1, a) * colors[c0 + 4] : 0
      }
      // 末尾接到粒子当前位置（最后一段不足采样间距）；头部用粒子本体透明度
      pts[n * 2] = tracers.x[i]
      pts[n * 2 + 1] = tracers.y[i]
      fade[n] = colors[c0 + 3] * env
      b.polylineFade(pts, np * 2, TRACER_LINE_WIDTH, colors[c0], colors[c0 + 1], colors[c0 + 2], fade)
      // 头部圆帽：轨迹末端的平头截断感
      b.disc(tracers.x[i], tracers.y[i], TRACER_LINE_WIDTH / 2, TRACER_LINE_WIDTH / 2, 0, 8, colors[c0], colors[c0 + 1], colors[c0 + 2], fade[n])
    }

    // 头部点在所有线条之后绘制，保证点在线上
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

  /** 纸飞机拖尾：按时间淡出的石墨蓝灰轨迹，宽度与透明度随存留连续变化 */
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
    const g0 = sim.level.ground(p.x - SHADOW_RADIUS)
    const g1 = sim.level.ground(p.x + SHADOW_RADIUS)
    const slope = Math.atan2(g1 - g0, SHADOW_RADIUS * 2)
    const sy = sim.level.ground(p.x) - SHADOW_LIFT
    b.disc(p.x, sy, SHADOW_RADIUS, SHADOW_RY, slope, 24, ...INK_DARK, SHADOW_MAX_ALPHA)

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
      // round：折线首尾圆润，四角成圆弧过渡
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
