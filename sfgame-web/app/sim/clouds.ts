import type { FluidLike } from './fluid.ts'
import type { TerrainLike } from './terrain.ts'
import type { WorldBounds } from './types.ts'

export const CLOUD_COUNT = 3
// 半径 ×√(2/3)：视觉面积（感知体积）约为原设计的 2/3
const CLOUD_R_MIN = 4.6
const CLOUD_R_SPAN = 3.3
// 出生高度带（占世界高度比例）：天空区——须容下 count 朵云的垂直间隔，太窄则拒绝采样几何无解
const ALT_LOW_F = 0.12
const ALT_SPAN_F = 0.28
// 销毁边界 ≈ letterbox 溢绘：云完全出图（含宽屏溢绘）才销毁，不在图内回收
const DESPAWN_MARGIN = 12
// 距地表（SDF）最小距离：云不钻山，接近山体提前淡出
const FADE_ALT = 3
const ALPHA_RATE = 1.2
const ALPHA_DEAD = 0.02
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
// （sponge 吸收层是数值边界 artifact，非真实静风）；生成一律在图内均匀散布（拒绝采样保证间隔），
// 随风出图销毁，累积下降超限消散（自然寿命）
export class Clouds {
  readonly count: number
  x: Float32Array
  y: Float32Array
  radius: Float32Array
  alpha: Float32Array
  // 每朵云的程序化噪声种子（渲染 GLSL 用），同关可复现
  seed: Float32Array

  private desc: Float32Array
  private world: WorldBounds
  private terrain: TerrainLike
  private rng: () => number
  private tmpAir = { x: 0, y: 0 }
  private tmpSky = { x: 0, y: 0 }

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
    this.desc = new Float32Array(count)
    for (let i = 0; i < count; i++) this.respawn(i)
  }

  // 图内均匀散布 + 拒绝采样间隔；desc 随机错开防齐生齐死
  private respawn(i: number) {
    const { w, h } = this.world
    const rng = this.rng
    const r = CLOUD_R_MIN + rng() * CLOUD_R_SPAN
    let x = 0
    let y = 0
    let bestNear = -1
    for (let t = 0; t < SPAWN_TRIES; t++) {
      const cx = 4 + rng() * (w - 8)
      const cy = Math.max(2, h * (ALT_LOW_F + rng() * ALT_SPAN_F))
      let ok = true
      let near = Infinity
      for (let j = 0; j < this.count; j++) {
        if (j === i) continue
        const gap = (r + this.radius[j]) * SPAWN_GAP_K
        const d2 = (this.x[j] - cx) ** 2 + (this.y[j] - cy) ** 2
        near = Math.min(near, d2)
        if (d2 < gap * gap) ok = false
      }
      if (ok) {
        x = cx
        y = cy
        break
      }
      // 全失败时取最远候选兜底：宁散勿贴
      if (near > bestNear) {
        bestNear = near
        x = cx
        y = cy
      }
    }
    this.x[i] = x
    this.y[i] = y
    this.radius[i] = r
    this.seed[i] = rng() * 64
    this.alpha[i] = 0
    this.desc[i] = rng() * DESCEND_MAX * 0.5
  }

  step(dt: number, fluid: FluidLike) {
    const { w, h } = this.world
    const sky = this.tmpSky
    const air = this.tmpAir
    // 天空代表点采样一次：图外远场风
    fluid.sampleVelocity(w * 0.5, h * 0.2, sky)
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
      const dy = air.y * dt
      this.x[i] = x + air.x * dt
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
