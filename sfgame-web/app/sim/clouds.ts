import type { FluidLike } from './fluid'
import type { TerrainLike } from './terrain'
import type { WorldBounds } from './types'

const CLOUD_COUNT = 3
const CLOUD_R_MIN = 5.6
const CLOUD_R_SPAN = 4.0
// 出生高度带（占世界高度比例）：上三分之一天空区
const ALT_LOW_F = 0.12
const ALT_SPAN_F = 0.18
const SPAWN_BAND_MIN = 8
const SPAWN_BAND_SPAN = 12
const DESPAWN_MARGIN = 30
const FADE_ALT = 3
const DESCEND_LIMIT = 16
const RESPOND_H = 1.2
const RESPOND_V = 0.25
const HOME_RESTORE = 0.06
const ALPHA_RATE = 1.2
const ALPHA_DEAD = 0.02
const IN_AIR_RATIO = 0.7

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

// 视觉层物理：云被动平流于风场，不参与关卡判定
export class Clouds {
  readonly count: number
  x: Float32Array
  y: Float32Array
  radius: Float32Array
  alpha: Float32Array

  private vx: Float32Array
  private vy: Float32Array
  private homeY: Float32Array
  private descent: Float32Array
  private world: WorldBounds
  private terrain: TerrainLike
  private rng: () => number
  private tmpAir = { x: 0, y: 0 }

  constructor(levelId: number, world: WorldBounds, terrain: TerrainLike, count = CLOUD_COUNT) {
    this.count = count
    this.world = world
    this.terrain = terrain
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

  private respawn(i: number) {
    const { w, h } = this.world
    const rng = this.rng
    let x: number
    if (rng() < IN_AIR_RATIO) {
      x = 4 + rng() * (w - 8)
    } else {
      const band = SPAWN_BAND_MIN + rng() * SPAWN_BAND_SPAN
      x = rng() < 0.5 ? -band : w + band
    }
    const y = Math.max(2, h * (ALT_LOW_F + rng() * ALT_SPAN_F))
    this.x[i] = x
    this.y[i] = y
    this.homeY[i] = y
    this.radius[i] = CLOUD_R_MIN + rng() * CLOUD_R_SPAN
    this.vx[i] = 0
    this.vy[i] = 0
    this.descent[i] = 0
    this.alpha[i] = 0
  }

  step(dt: number, fluid: FluidLike) {
    const { w } = this.world
    const air = this.tmpAir
    for (let i = 0; i < this.count; i++) {
      const x = this.x[i]
      const y = this.y[i]
      // 距地表（SDF）足够远才算存活：云不会钻山
      const live =
        x > -DESPAWN_MARGIN &&
        x < w + DESPAWN_MARGIN &&
        y > -DESPAWN_MARGIN &&
        this.terrain.sample(x, y) > FADE_ALT &&
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
