import type { Fluid } from './fluid'
import type { WorldBounds } from './types'

/** 云数量：76×56 世界尺度下 3 朵（体积大、间距开，克制） */
const CLOUD_COUNT = 3
/** 云半径范围（世界单位）：体积上限约太阳（r=4）的 14 倍（8~15 倍区间） */
const CLOUD_R_MIN = 5.6
const CLOUD_R_SPAN = 4.0
/** 出生高度：离地（该处地形）的 60%~85% 高度处——天空上三分之一、靠近顶部 */
const ALT_LOW_F = 0.6
const ALT_SPAN_F = 0.25
/** 地图外出生带：超出左右边界的距离区间（云从画布外漂入） */
const SPAWN_BAND_MIN = 8
const SPAWN_BAND_SPAN = 12
/** 超出地图该距离（或高于顶界）即淡出消失 */
const DESPAWN_MARGIN = 30
/** 云底低到该离地高度即淡出：贴地或被下沉风按到地 = 云消（阈值高于地形，先淡后消失） */
const FADE_ALT = 3
/** 一生中累积下沉距离达此值即淡出：被下沉风反复压低的云，比贴地更早消散 */
const DESCEND_LIMIT = 16
/** 水平 / 垂直风响应（1/s）：横快纵慢——"难下降"的物理性格 */
const RESPOND_H = 1.2
const RESPOND_V = 0.25
/** 向出生高度的弱回复（1/s）：无风时缓慢回归，维持一定高度 */
const HOME_RESTORE = 0.06
/** 淡入淡出速率（1/s，约 2 秒过渡） */
const ALPHA_RATE = 1.2
/** 淡没判定阈值：alpha 低于此值即视为消失，按序列重生 */
const ALPHA_DEAD = 0.02
/** 出生位置里"空中"的比例，其余出生在地图外 */
const IN_AIR_RATIO = 0.7

/** 可复现 PRNG（mulberry32）：同一 level id → 同一片云，重开/重放布局稳定 */
const mulberry32 = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 云（视觉层物理，无头可测）：被动平流于风场，为天空加一层活的天气感。
 * 不参与关卡判定；未来若要做云的玩法，此模块可整体升级为实体。
 * 物理性格从简：一阶低通跟随风（水平快垂直慢）→ 云难下降；弱回复回
 * 出生高度 → 维持一定高度；被压到离地 FADE_ALT 以下、一生累积下沉达
 * DESCEND_LIMIT、或漂出地图 DESPAWN_MARGIN 即淡出，淡没后按伪随机
 * 序列在"空中/地图外"重生。
 */
export class Clouds {
  readonly count: number
  /** 云心位置 / 半径 / 不透明度（0..1，渲染与淡出共用同一包络） */
  x: Float32Array
  y: Float32Array
  radius: Float32Array
  alpha: Float32Array

  private vx: Float32Array
  private vy: Float32Array
  private homeY: Float32Array
  /** 本朵云累积下沉距离（y 增量的正部分累计） */
  private descent: Float32Array
  private world: WorldBounds
  private groundY: (x: number) => number
  private rng: () => number
  private tmpAir = { x: 0, y: 0 }

  constructor(levelId: number, world: WorldBounds, groundY: (x: number) => number, count = CLOUD_COUNT) {
    this.count = count
    this.world = world
    this.groundY = groundY
    // 黄金比例哈希：相邻 id 的关卡布局也彼此不同
    this.rng = mulberry32(Math.imul(levelId, 0x9e3779b1))
    this.x = new Float32Array(count)
    this.y = new Float32Array(count)
    this.radius = new Float32Array(count)
    this.alpha = new Float32Array(count)
    this.vx = new Float32Array(count)
    this.vy = new Float32Array(count)
    this.homeY = new Float32Array(count)
    this.descent = new Float32Array(count)
    for (let i = 0; i < count; i++) this.respawn(i)
  }

  /** 出生域：70% 空中、30% 地图外（界外高度按最近边缘地形计算）。 */
  private respawn(i: number) {
    const { w } = this.world
    const rng = this.rng
    let x: number
    if (rng() < IN_AIR_RATIO) {
      x = 4 + rng() * (w - 8)
    } else {
      const band = SPAWN_BAND_MIN + rng() * SPAWN_BAND_SPAN
      x = rng() < 0.5 ? -band : w + band
    }
    const gx = x < 0 ? 0 : x > w ? w : x
    const y = Math.max(2, this.groundY(gx) * (1 - ALT_LOW_F - rng() * ALT_SPAN_F))
    this.x[i] = x
    this.y[i] = y
    this.homeY[i] = y
    this.radius[i] = CLOUD_R_MIN + rng() * CLOUD_R_SPAN
    this.vx[i] = 0
    this.vy[i] = 0
    this.descent[i] = 0
    this.alpha[i] = 0
  }

  step(dt: number, fluid: Fluid) {
    const { w } = this.world
    const air = this.tmpAir
    for (let i = 0; i < this.count; i++) {
      const x = this.x[i]
      const y = this.y[i]
      const gx = x < 0 ? 0 : x > w ? w : x
      const live =
        x > -DESPAWN_MARGIN &&
        x < w + DESPAWN_MARGIN &&
        y > -DESPAWN_MARGIN &&
        y < this.groundY(gx) - FADE_ALT &&
        this.descent[i] < DESCEND_LIMIT
      const target = live ? 1 : 0
      const a = this.alpha[i] + (target - this.alpha[i]) * (1 - Math.exp(-dt * ALPHA_RATE))
      this.alpha[i] = a
      if (a <= ALPHA_DEAD && target === 0) {
        this.respawn(i)
        continue
      }
      fluid.sampleVelocity(x, y, air)
      const vx = this.vx[i] + (air.x - this.vx[i]) * (1 - Math.exp(-dt * RESPOND_H))
      const vy =
        this.vy[i] +
        (air.y - this.vy[i]) * (1 - Math.exp(-dt * RESPOND_V)) +
        (this.homeY[i] - y) * (1 - Math.exp(-dt * HOME_RESTORE))
      this.vx[i] = vx
      this.vy[i] = vy
      const ny = y + vy * dt
      this.y[i] = ny
      const dy = ny - y
      if (dy > 0) this.descent[i] += dy
      this.x[i] = x + vx * dt
    }
  }
}
