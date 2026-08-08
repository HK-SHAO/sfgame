import type { FluidLike } from './fluid'
import type { SourceKind, WorldBounds } from './types'

interface SourcePoint {
  x: number
  y: number
  kind: SourceKind
}

export const TRAIL_LEN = 24
const TRAIL_SAMPLE = 0.45
const FADE_IN = 0.5
const FADE_OUT = 0.7
const RESPAWN_TRIES = 8
const PLUME_PER_STEP = 2
const PLUME_RADIUS = 1.6
const PLUME_LIFE_MIN = 0.9
const PLUME_LIFE_SPAN = 1.2

export class Tracers {
  count: number
  readonly trailLen: number
  x: Float32Array
  y: Float32Array
  life: Float32Array
  maxLife: Float32Array
  odo: Float32Array
  trailX: Float32Array
  trailY: Float32Array
  trailT: Float32Array
  trailN: Uint8Array
  time = 0

  private lastOdo: Float32Array
  private world: WorldBounds
  private groundY: (x: number) => number
  private margin: number
  private air = { x: 0, y: 0 }

  constructor(
    count: number,
    world: WorldBounds,
    groundY: (x: number) => number,
    trailLen = TRAIL_LEN,
    margin = 0,
  ) {
    this.count = count
    this.trailLen = trailLen
    this.world = world
    this.groundY = groundY
    this.margin = margin
    this.x = new Float32Array(count)
    this.y = new Float32Array(count)
    this.life = new Float32Array(count)
    this.maxLife = new Float32Array(count)
    this.odo = new Float32Array(count)
    this.trailX = new Float32Array(count * trailLen)
    this.trailY = new Float32Array(count * trailLen)
    this.trailT = new Float32Array(count * trailLen)
    this.trailN = new Uint8Array(count)
    this.lastOdo = new Float32Array(count)
    for (let i = 0; i < count; i++) this.respawn(i, true)
  }

  private respawn(i: number, scatter = false) {
    const { w } = this.world
    for (let tries = 0; tries < RESPAWN_TRIES; tries++) {
      // 重生范围与边界严格镜像 [0.5, w-0.5]：左右空白带一致（右缘粒子被风顶在墙边显密，左缘须同宽出生）
      const x = 0.5 + Math.random() * (w - 1)
      const ceil = this.groundY(x) - 1.5
      if (ceil < 3) continue
      const y = 2 + Math.random() * (ceil - 2)
      this.x[i] = x
      this.y[i] = y
      this.maxLife[i] = 2.5 + Math.random() * 4
      this.life[i] = scatter ? Math.random() * this.maxLife[i] : this.maxLife[i]
      this.resetTrail(i)
      // 出生即记首段轨迹：左缘粒子出生即被风带走，首段轨迹延迟 0.45 单位会出现会让墙边留空
      this.recordTrail(i)
      return
    }
    this.x[i] = -100
    this.y[i] = -100
    this.life[i] = 0.1
    this.resetTrail(i)
  }

  private resetTrail(i: number) {
    this.odo[i] = 0
    this.lastOdo[i] = 0
    this.trailN[i] = 0
  }

  private recordTrail(i: number) {
    const base = i * this.trailLen
    const len = this.trailLen
    const n = this.trailN[i]
    if (n < len) {
      this.trailX[base + n] = this.x[i]
      this.trailY[base + n] = this.y[i]
      this.trailT[base + n] = this.time
      this.trailN[i] = n + 1
    } else {
      this.trailX.copyWithin(base, base + 1, base + len)
      this.trailY.copyWithin(base, base + 1, base + len)
      this.trailT.copyWithin(base, base + 1, base + len)
      this.trailX[base + len - 1] = this.x[i]
      this.trailY[base + len - 1] = this.y[i]
      this.trailT[base + len - 1] = this.time
    }
    this.lastOdo[i] = this.odo[i]
  }

  envelope(i: number): number {
    const age = this.maxLife[i] - this.life[i]
    const env = Math.min(1, age / FADE_IN, this.life[i] / FADE_OUT)
    return env < 0 ? 0 : env
  }

  step(dt: number, fluid: FluidLike, sources: ReadonlyArray<SourcePoint>) {
    this.time += dt
    const air = this.air
    for (let i = 0; i < this.count; i++) {
      this.life[i] -= dt
      if (this.life[i] <= 0) {
        this.respawn(i)
        continue
      }
      fluid.sampleVelocity(this.x[i], this.y[i], air)
      const nx = this.x[i] + (air.x + (Math.random() - 0.5) * 0.5) * dt
      const ny = this.y[i] + (air.y + (Math.random() - 0.5) * 0.5) * dt
      const dx = nx - this.x[i]
      const dy = ny - this.y[i]
      this.odo[i] += Math.sqrt(dx * dx + dy * dy)
      this.x[i] = nx
      this.y[i] = ny
      if (this.odo[i] - this.lastOdo[i] >= TRAIL_SAMPLE) this.recordTrail(i)
      const gy = this.groundY(this.x[i]) - 0.4
      // 允许飞出地图：流体域外扩边距内继续随风流动，接近边距末端才清理（可见区无堆积/断崖）
      const m = this.margin
      if (
        this.y[i] > gy ||
        this.y[i] < 1 - m ||
        this.x[i] < 1 - m ||
        this.x[i] > this.world.w + m - 1
      ) {
        this.respawn(i)
      }
    }

    if (sources.length > 0) {
      for (let n = 0; n < PLUME_PER_STEP; n++) {
        const s = sources[(Math.random() * sources.length) | 0]
        const i = (Math.random() * this.count) | 0
        const ang = Math.random() * Math.PI * 2
        const rad = Math.random() * PLUME_RADIUS
        const x = s.x + Math.cos(ang) * rad
        const y = s.y + Math.sin(ang) * rad
        if (y > this.groundY(x) - 0.6 || y < 1) continue
        this.x[i] = x
        this.y[i] = y
        this.maxLife[i] = PLUME_LIFE_MIN + Math.random() * PLUME_LIFE_SPAN
        this.life[i] = this.maxLife[i]
        this.resetTrail(i)
        this.recordTrail(i)
      }
    }
  }
}
