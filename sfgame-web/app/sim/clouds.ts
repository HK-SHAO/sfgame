import type { FluidLike } from './fluid'
import type { TerrainLike } from './terrain'
import type { WorldBounds } from './types'

const CLOUD_COUNT = 3
// 半径 ×√(2/3)：视觉面积（感知体积）约为原设计的 2/3
const CLOUD_R_MIN = 4.6
const CLOUD_R_SPAN = 3.3
// 出生高度带（占世界高度比例）：上三分之一天空区
const ALT_LOW_F = 0.12
const ALT_SPAN_F = 0.18
// 销毁边界 ≈ letterbox 溢绘：云完全出图（含宽屏溢绘）才销毁，不在图内回收
const DESPAWN_MARGIN = 12
// 距地表（SDF）最小距离：云不钻山，接近山体提前淡出
const FADE_ALT = 3
const ALPHA_RATE = 1.2
const ALPHA_DEAD = 0.02
// 出生漂移：流体域外 sponge 吸收风采样≈0，云靠出生时朝视图的自身速度入场，入场后指数衰减交还风场
const DRIFT_MIN = 2.5
const DRIFT_SPAN = 1.5
const DRIFT_DECAY = 0.25
// 累积下降消散：下沉空气绝热增温、云滴蒸发——云的自然寿命，无需人工年龄
const DESCEND_MAX = 7
// 生成间距拒绝采样：免云贴生合并成一团
const SPAWN_TRIES = 6
const SPAWN_GAP_K = 1.15

// 可复现 PRNG（mulberry32，黄金比例哈希使相邻 id 布局也分散）：同一 level id → 同一片云
const mulberry32 = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 云 = 风的被动示踪物（第一性原理：云就是空气本身）：图内速度 = 当地风，图外 = 天空远场风
// （sponge 吸收层是数值边界 artifact，非真实静风）+ 出生漂移；垂直同被平流；
// 自风的来向入场、出图销毁，累积下降超限消散（自然寿命）
export class Clouds {
  readonly count: number
  x: Float32Array
  y: Float32Array
  radius: Float32Array
  alpha: Float32Array
  // 每朵云的程序化噪声种子（渲染 GLSL 用），同关可复现
  seed: Float32Array

  private drift: Float32Array
  private desc: Float32Array
  private world: WorldBounds
  private terrain: TerrainLike
  private rng: () => number
  private tmpAir = { x: 0, y: 0 }
  private tmpSky = { x: 0, y: 0 }
  // 天空风向（符号）：决定重生在哪侧上风场外
  private skyWind = 1

  constructor(levelId: number, world: WorldBounds, terrain: TerrainLike, count = CLOUD_COUNT) {
    this.count = count
    this.world = world
    this.terrain = terrain
    this.rng = mulberry32(Math.imul(levelId, 0x9e3779b1))
    this.x = new Float32Array(count)
    this.y = new Float32Array(count)
    this.radius = new Float32Array(count)
    this.alpha = new Float32Array(count)
    this.seed = new Float32Array(count)
    this.drift = new Float32Array(count)
    this.desc = new Float32Array(count)
    for (let i = 0; i < count; i++) this.respawn(i, true)
  }

  // init（scatter）散布场内：出场即玩家可见；运行时自上风侧场外入场——云从风源方向飘来，
  // 入场点取在销毁边界内、流体域 sponge 带，出生漂移载其穿过无风区
  private respawn(i: number, scatter = false) {
    const { w, h } = this.world
    const rng = this.rng
    const r = CLOUD_R_MIN + rng() * CLOUD_R_SPAN
    let x = 0
    let y = 0
    for (let t = 0; t < SPAWN_TRIES; t++) {
      x = scatter
        ? 4 + rng() * (w - 8)
        : this.skyWind >= 0
          ? -(2 + rng() * 8)
          : w + 2 + rng() * 8
      y = Math.max(2, h * (ALT_LOW_F + rng() * ALT_SPAN_F))
      let ok = true
      for (let j = 0; j < this.count; j++) {
        if (j === i) continue
        // init 时全体都即将淡入，间距全查；运行时已死（alpha≈0）的云不参与约束
        if (!scatter && this.alpha[j] <= ALPHA_DEAD) continue
        const gap = (r + this.radius[j]) * SPAWN_GAP_K
        const dx = this.x[j] - x
        const dy = this.y[j] - y
        if (dx * dx + dy * dy < gap * gap) {
          ok = false
          break
        }
      }
      if (ok) break
    }
    this.x[i] = x
    this.y[i] = y
    this.radius[i] = r
    this.seed[i] = rng() * 64
    this.alpha[i] = 0
    // 漂移朝视图方向（与入场侧相反）；scatter 同样赋值，衰减期内即消
    this.drift[i] = (this.skyWind >= 0 ? 1 : -1) * (DRIFT_MIN + rng() * DRIFT_SPAN)
    // scatter 错开累积下降，避免齐生齐死
    this.desc[i] = scatter ? rng() * DESCEND_MAX * 0.5 : 0
  }

  step(dt: number, fluid: FluidLike) {
    const { w, h } = this.world
    const sky = this.tmpSky
    const air = this.tmpAir
    // 天空代表点采样一次：上风入场偏好 + 图外远场风
    fluid.sampleVelocity(w * 0.5, h * 0.2, sky)
    if (sky.x !== 0) this.skyWind = sky.x
    const driftK = Math.exp(-dt * DRIFT_DECAY)
    for (let i = 0; i < this.count; i++) {
      const x = this.x[i]
      const y = this.y[i]
      if (x >= 0 && x <= w && y >= 0 && y <= h) {
        fluid.sampleVelocity(x, y, air)
      } else {
        // 图外不采 sponge 带（衰减≈0 会让云堆积边界）：远场风 = 天空风
        air.x = sky.x
        air.y = sky.y
      }
      this.drift[i] *= driftK
      const dy = air.y * dt
      this.x[i] = x + (air.x + this.drift[i]) * dt
      this.y[i] = y + dy
      if (dy > 0) this.desc[i] += dy
      // 存活 = 未出销毁边界（四向）+ 距地表足够远 + 累积下降未超限
      const live =
        x > -DESPAWN_MARGIN &&
        x < w + DESPAWN_MARGIN &&
        y > -DESPAWN_MARGIN &&
        y < h + DESPAWN_MARGIN &&
        this.terrain.sample(x, y) > FADE_ALT &&
        this.desc[i] < DESCEND_MAX
      const a = this.alpha[i] + ((live ? 1 : 0) - this.alpha[i]) * (1 - Math.exp(-dt * ALPHA_RATE))
      this.alpha[i] = a
      if (a <= ALPHA_DEAD && !live) this.respawn(i)
    }
  }
}
