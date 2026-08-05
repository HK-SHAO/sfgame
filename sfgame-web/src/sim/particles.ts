import type { Fluid } from './fluid'
import type { SourceKind, WorldBounds } from './types'

interface SourcePoint {
  x: number
  y: number
  kind: SourceKind
}

/** 每颗粒子记录的轨迹点数（实例可调：移动端缩短以控制描边负载） */
export const TRAIL_LEN = 24
const TRAIL_SAMPLE = 0.45
/** 轨迹点自记录后随**时间**淡出的总时长（秒） */
export const TRAIL_FADE_T = 5
/** 生命首尾的淡入/淡出时长（秒），避免粒子凭空闪现 */
const FADE_IN = 0.5
const FADE_OUT = 0.7
/** 随机重生的位置尝试次数（地形下无空位时放弃） */
const RESPAWN_TRIES = 8
const PLUME_PER_STEP = 2
/** 羽流粒子绕源散开的半径 / 生命范围（秒） */
const PLUME_RADIUS = 1.6
const PLUME_LIFE_MIN = 0.9
const PLUME_LIFE_SPAN = 1.2

/**
 * 示踪粒子（拉格朗日）：被动平流于风场，把看不见的风可视化。
 * 颜色由局部温度决定（热红冷蓝中性灰），透明度随风速增大——"有风的地方才看得见风"；
 * 每条按**时间**淡出的短轨迹（streakline）营造风场线条感，粒子停驻时轨迹同样老化消失。
 */
export class Tracers {
  count: number
  /** 轨迹点数上限（按设备档位传入，控制描边负载） */
  readonly trailLen: number
  x: Float32Array
  y: Float32Array
  life: Float32Array
  maxLife: Float32Array
  /** 各粒子累计路程（仅用于等距采样） */
  odo: Float32Array
  /** 轨迹点坐标与写入时刻，按 count×trailLen 平铺 */
  trailX: Float32Array
  trailY: Float32Array
  trailT: Float32Array
  /** 各粒子当前轨迹点数（≤ trailLen） */
  trailN: Uint8Array
  /** 模拟时钟（step 累计），轨迹淡出的时间基准 */
  time = 0

  private lastOdo: Float32Array
  private world: WorldBounds
  private groundY: (x: number) => number
  /** 采样复用对象：热路径零分配 */
  private air = { x: 0, y: 0 }

  constructor(count: number, world: WorldBounds, groundY: (x: number) => number, trailLen = TRAIL_LEN) {
    this.count = count
    this.trailLen = trailLen
    this.world = world
    this.groundY = groundY
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
      const x = 2 + Math.random() * (w - 4)
      const ceil = this.groundY(x) - 1.5
      if (ceil < 3) continue
      const y = 2 + Math.random() * (ceil - 2)
      this.x[i] = x
      this.y[i] = y
      this.maxLife[i] = 2.5 + Math.random() * 4
      this.life[i] = scatter ? Math.random() * this.maxLife[i] : this.maxLife[i]
      this.resetTrail(i)
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

  /** 生命首尾淡入淡出包络（0..1），供渲染层调制整体透明度。 */
  envelope(i: number): number {
    const age = this.maxLife[i] - this.life[i]
    const env = Math.min(1, age / FADE_IN, this.life[i] / FADE_OUT)
    return env < 0 ? 0 : env
  }

  step(dt: number, fluid: Fluid, sources: ReadonlyArray<SourcePoint>) {
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
      if (
        this.y[i] > gy ||
        this.y[i] < 0.5 ||
        this.x[i] < 0.5 ||
        this.x[i] > this.world.w - 0.5
      ) {
        this.respawn(i)
      }
    }

    // 在活跃的源附近补充"羽流"粒子，强化因果感
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
      }
    }
  }
}
