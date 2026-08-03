import type { Fluid } from './fluid'
import type { SourceKind, WorldBounds } from './types'

interface SourcePoint {
  x: number
  y: number
  kind: SourceKind
}

/** 每颗粒子记录的轨迹点数（实例可调：移动端缩短以控制描边负载） */
export const TRAIL_LEN = 24
/** 粒子每走过该路程记录一个轨迹点（等距采样） */
const TRAIL_SAMPLE = 0.45
/** 轨迹点自记录后随路程淡出的总长度 */
export const TRAIL_FADE = 10
/** 生命首尾的淡入/淡出时长（秒），避免粒子凭空闪现 */
const FADE_IN = 0.5
const FADE_OUT = 0.7

/**
 * 示踪粒子（拉格朗日）：被动平流于风场，把看不见的气流可视化。
 * 颜色由所在位置的局部温度决定（热偏红、冷偏蓝、中性灰），
 * 透明度随风速增大——"有风的地方才看得见风"。
 *
 * 每颗粒子另有一条按**路程**淡出的短轨迹（streakline），
 * 营造真实的风场线条感；粒子停驻时轨迹不消失。
 */
export class Tracers {
  count: number
  /** 轨迹点数上限（按设备档位传入，控制描边负载） */
  readonly trailLen: number
  x: Float32Array
  y: Float32Array
  life: Float32Array
  maxLife: Float32Array
  /** 各粒子累计路程（里程表） */
  odo: Float32Array
  /** 轨迹点坐标与写入时里程，按 count×trailLen 平铺 */
  trailX: Float32Array
  trailY: Float32Array
  trailO: Float32Array
  /** 各粒子当前轨迹点数（≤ trailLen） */
  trailN: Uint8Array

  private lastOdo: Float32Array
  private world: WorldBounds
  private groundY: (x: number) => number

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
    this.trailO = new Float32Array(count * trailLen)
    this.trailN = new Uint8Array(count)
    this.lastOdo = new Float32Array(count)
    for (let i = 0; i < count; i++) this.respawn(i, true)
  }

  private respawn(i: number, scatter = false) {
    const { w } = this.world
    for (let tries = 0; tries < 8; tries++) {
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
      this.trailO[base + n] = this.odo[i]
      this.trailN[i] = n + 1
    } else {
      // 满：整体前移丢弃最旧点
      this.trailX.copyWithin(base, base + 1, base + len)
      this.trailY.copyWithin(base, base + 1, base + len)
      this.trailO.copyWithin(base, base + 1, base + len)
      this.trailX[base + len - 1] = this.x[i]
      this.trailY[base + len - 1] = this.y[i]
      this.trailO[base + len - 1] = this.odo[i]
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
    const air = { x: 0, y: 0 }
    for (let i = 0; i < this.count; i++) {
      this.life[i] -= dt
      if (this.life[i] <= 0) {
        this.respawn(i)
        continue
      }
      fluid.sampleVelocity(this.x[i], this.y[i], air)
      const nx = this.x[i] + (air.x + (Math.random() - 0.5) * 0.5) * dt
      const ny = this.y[i] + (air.y + (Math.random() - 0.5) * 0.5) * dt
      this.odo[i] += Math.hypot(nx - this.x[i], ny - this.y[i])
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
      for (let n = 0; n < 2; n++) {
        const s = sources[(Math.random() * sources.length) | 0]
        const i = (Math.random() * this.count) | 0
        const ang = Math.random() * Math.PI * 2
        const rad = Math.random() * 1.6
        const x = s.x + Math.cos(ang) * rad
        const y = s.y + Math.sin(ang) * rad
        if (y > this.groundY(x) - 0.6 || y < 1) continue
        this.x[i] = x
        this.y[i] = y
        this.maxLife[i] = 0.9 + Math.random() * 1.2
        this.life[i] = this.maxLife[i]
        this.resetTrail(i)
      }
    }
  }
}
