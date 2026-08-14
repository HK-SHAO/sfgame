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
// 恢复迟滞（P2）：进入消散立即、恢复须越过余量——山边/边缘颠簸不再逐 tick 翻转 alpha 目标（呼吸闪烁）
const FADE_ALT_HYST = 1.5
const EDGE_HYST = 2
const ALPHA_RATE = 1.2
// 渲染可见阈值（云顶点批同源消费）：死亡阈值取其 1/4——先隐形后重生，永不"可见着瞬移"（P5）
export const CLOUD_VISIBLE_ALPHA = 0.02
const ALPHA_DEAD = CLOUD_VISIBLE_ALPHA * 0.25
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
  // 生命周期态（P2 迟滞）：0 = 存活、1 = 消散中；进入立即、恢复须越过余量
  private fade: Uint8Array
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
    this.fade = new Uint8Array(count)
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
        // 跳过自身与未生成邻居（构造期 j>i 的 radius 为 0，参与间距判定会误拒左上角候选，P4）
        if (j === i || this.radius[j] === 0) continue
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
    this.fade[i] = 0
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
      const inBox =
        x > -DESPAWN_MARGIN &&
        x < w + DESPAWN_MARGIN &&
        y > -DESPAWN_MARGIN &&
        y < h + DESPAWN_MARGIN
      const dist = this.terrain.sample(x, y)
      const alive = inBox && dist > FADE_ALT && this.desc[i] < DESCEND_MAX
      // 迟滞：进入消散立即；恢复须同时满足全部余量（desc 单调只增，天然无迟滞需求）
      if (this.fade[i] === 0 && !alive) this.fade[i] = 1
      else if (this.fade[i] === 1) {
        const relaxed =
          x > EDGE_HYST - DESPAWN_MARGIN &&
          x < w + DESPAWN_MARGIN - EDGE_HYST &&
          y > EDGE_HYST - DESPAWN_MARGIN &&
          y < h + DESPAWN_MARGIN - EDGE_HYST &&
          dist > FADE_ALT + FADE_ALT_HYST &&
          this.desc[i] < DESCEND_MAX
        if (relaxed) this.fade[i] = 0
      }
      const target = this.fade[i] === 1 ? 0 : 1
      const a = this.alpha[i] + (target - this.alpha[i]) * (1 - Math.exp(-dt * ALPHA_RATE))
      this.alpha[i] = a
      // 重生条件看生命周期态而非瞬时 live：迟滞期云仍隐形，不会卡在"永不复生"
      if (a <= ALPHA_DEAD && this.fade[i] === 1) this.respawn(i)
    }
  }
}
