// 模拟 worker 与主线程的跨线程协议（无 DOM，node 无头可测）。消息字段即契约。
// 流体场/示踪逐帧随 frame 消息以 SimViews 拷贝运送（transfer 移交所有权免双份拷贝）；
// 快照只携带 JS 侧状态（云/拖尾/源/时间/环境风强度）与每帧标量
import type { SourceKind } from './types.ts'
import type { FanDef, HudState, LevelJson, SourcePlacement } from '../game/types.ts'

// ---- 跨线程共用的渲染计算常数（单源）----
// 示踪粒子数量与包络常数原为 worker/particles.ts 局部值；主线程渲染
// 需要同一口径（视图长度、envelope 判定），统一收口于此。

// 示踪粒子数（内核容量编译期钉死，Tracers 构造与主线程视图长度共用）
export const TRACER_COUNT = 400

// 粒子包络（envelope）两常数：出生渐入 0.5s、临死渐出 0.7s——与 particles.ts envelope 同源
export const TRACER_FADE_IN = 0.5
export const TRACER_FADE_OUT = 0.7

// 轨迹尾段渐变段数（靠近起点的采样点线性减淡，头实尾虚）：渲染侧消费
export const TRACER_TAIL_SEGS = 5

// 渲染可见阈值：env≤此值的粒子整条记录跳过（免上传近零 alpha 顶点）
export const VISIBLE_ALPHA = 0.02

// 示踪粒子着色色板与曲线常数（与迁移前 render.ts 同值同语义）
export const AIR_AMBIENT: readonly [number, number, number] = [200 / 255, 197 / 255, 183 / 255]
export const HOT: readonly [number, number, number] = [255 / 255, 90 / 255, 60 / 255]
export const COLD: readonly [number, number, number] = [61 / 255, 139 / 255, 255 / 255]
export const AIR_SOFT = 0.35
export const HEAD_ALPHA_AMBIENT = 0.45
export const HEAD_ALPHA_STRONG = 0.85
export const LINE_ALPHA_AMBIENT = 0.18
export const LINE_ALPHA_COLORED = 0.42
export const GUST_BASE = 0.7
export const GUST_BOOST = 0.6
export const GUST_FULL_SPEED = 4

// 旗杆高（world 单位）：渲染画旗与旗面风采样共用（原 5.7 的约 2/3，目标区压低避免遮挡视线）
export const POLE_HEIGHT = 3.8

// 旗面风采样点偏移（相对目标锚点，world 单位）：渲染侧在共享场视图上采样（同点同语义）
export const FLAG_SAMPLE_DX = 1.6
export const FLAG_SAMPLE_DY = 1.4

// 主线程 hitSource 的命中半径（world 单位）：controller 复刻 simulation.ts 的私有常量
//（同值同语义，模拟文件受 golden 契约保护不可改；判定逻辑随快照镜像原样搬入主线程）
export const SOURCE_HIT_RADIUS = 3.0

// ---- 场/示踪视图（逐帧拷贝，与内核导出布局同构）----

// 流体场 u/v/t/fxU/fxV（nx×ny）+ 示踪内核全部缓冲。
// 布局与 moon 内核导出一一对应（engine-wasm.test canary 钉死），静态内存零增长视图恒定
export interface SimViews {
  u: Float32Array
  v: Float32Array
  t: Float32Array
  fxU: Float32Array
  fxV: Float32Array
  tracerX: Float32Array // TRACER_COUNT
  tracerY: Float32Array
  life: Float32Array
  maxLife: Float32Array
  trailX: Float32Array // TRACER_COUNT × TRAIL_LEN
  trailY: Float32Array
  trailT: Float32Array
  trailN: Uint8Array // TRACER_COUNT
}

// ---- 帧快照类型 ----

// 地形转移：ready 消息一次性送达（field 为独立副本可转移，主线程 terrainFromField 重建 Terrain）
export interface TerrainTransfer {
  nx: number
  ny: number
  cell: number
  originX: number
  originY: number
  field: Float32Array
}

// 目标：x/r 与关卡 JSON 一致；anchorY = 目标锚点 y（杆底落点，渲染据此画旗与检测圆）
export interface GoalView {
  x: number
  r: number
  anchorY: number
}

// 源（玩家源与固定源同构）：born/wallBorn 供渲染生长动画（墙钟口径，暂停时 born 差值恒 0）
export interface SourceView {
  id: number
  kind: SourceKind
  x: number
  y: number
  born: number
  wallBorn: number
}

// 云视图：与 Clouds 类同名字段布局一致（fillCloudVerts 可同时消费 Clouds 实例与快照）
export interface CloudsView {
  count: number
  x: Float32Array
  y: Float32Array
  radius: Float32Array
  alpha: Float32Array
  seed: Float32Array
}

// 纸飞机拖尾：worker 按 Trail 迭代序导出点数组（渲染追加当前飞机点），time 为 sim 时钟（淡出同钟读）
export interface PlaneTrailView {
  count: number
  time: number
  tx: Float32Array
  ty: Float32Array
  tt: Float32Array
}

// 帧快照：每 tick 构建一次；主线程渲染直接消费，快照缺失时跳过 draw
export interface FrameSnapshot {
  clouds: CloudsView
  planeTrail: PlaneTrailView
  plane: { x: number; y: number; angle: number }
  sources: SourceView[]
  visited: boolean[]
  time: number
  extra: number
  phase: 'playing' | 'won'
  // 环境风强度与温度偏置：主线程 bilinearSample 需叠加基场与温度（与内核浮力同源）
  ambient: { x: number; y: number; t: number }
  tickMs: number // worker 单 tick 耗时（governor/devTools 用）
}

// ---- 消息 ----

// 主→worker。load 携带主线程已解析的关卡 json（内置关卡同样走此路径，worker 免二次校验）：
// 内联 DIY 关卡无法用 id 重现（resolveLevel 只认内置 id），json 直达是唯一可靠来源
export type SimRequest =
  | { t: 'load'; levelId: string; json?: LevelJson; unlimited?: boolean }
  | { t: 'tick'; dt: number }
  | { t: 'place'; x: number; y: number; kind: SourceKind; clientX: number; clientY: number }
  | { t: 'remove'; id: number }
  | { t: 'applySources'; list: SourcePlacement[] }
  | { t: 'restart' }
  | { t: 'pause'; v: boolean }

// worker→主。place 携带的指针坐标经 worker 原样回传（deny 事件要落点做拒绝动画，
// 主线程不能差分——sim 状态已不在主线程）；wind 携带 px 供声像定位（同因）。
// frame 恒携带 SimViews 拷贝（transfer 移交所有权），主线程渲染直接消费
export type SimEvent =
  | {
      t: 'ready'
      terrain: TerrainTransfer
      world: { w: number; h: number }
      goals: GoalView[]
      fixedSources: SourceView[]
      fans: FanDef[]
    }
  | { t: 'frame'; snapshot: FrameSnapshot; views: SimViews }
  | { t: 'hud'; state: HudState }
  | { t: 'phase'; phase: 'playing' | 'won'; won: boolean }
  | { t: 'visited'; won: boolean }
  | { t: 'placed'; kind: SourceKind }
  | { t: 'removed' }
  | { t: 'deny'; kind: SourceKind; clientX: number; clientY: number }
  | { t: 'wind'; field: number; rel: number; px: number }
  | { t: 'land'; intensity: number }
  | { t: 'sources'; list: SourcePlacement[] }
