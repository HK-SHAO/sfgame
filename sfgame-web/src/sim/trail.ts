/**
 * 时间驱动的拖尾轨迹（拉格朗日记录）：每点记录写入时刻，淡出 = 距当前时刻 / fadeTime——
 * 物体停住时旧点照常老化消失，运动越快新点越密。环形缓冲、按路程等距采样，索引 0 为最旧。
 * 无 DOM 依赖，可无头测试。
 */
export class Trail {
  readonly maxPoints: number
  readonly sampleDist: number
  readonly fadeTime: number
  /** 当前模拟时刻（每次 push 刷新） */
  time = 0
  /** 缓冲中的点数（≤ maxPoints） */
  count = 0

  private xs: Float32Array
  private ys: Float32Array
  /** 各点写入时刻 */
  private ts: Float32Array
  private head = 0
  /** 累计路程（世界单位，仅用于等距采样） */
  private odo = 0
  private lastOdo = 0
  private lastX = Number.NaN
  private lastY = Number.NaN

  constructor(maxPoints: number, sampleDist: number, fadeTime: number) {
    this.maxPoints = maxPoints
    this.sampleDist = sampleDist
    this.fadeTime = fadeTime
    this.xs = new Float32Array(maxPoints)
    this.ys = new Float32Array(maxPoints)
    this.ts = new Float32Array(maxPoints)
  }

  /** 记录物体当前位置与时刻；路程未达采样间隔则只推进时刻。 */
  push(x: number, y: number, t: number) {
    this.time = t
    if (Number.isNaN(this.lastX)) {
      this.lastX = x
      this.lastY = y
      this.record(x, y, t)
      return
    }
    const dx = x - this.lastX
    const dy = y - this.lastY
    const d = Math.sqrt(dx * dx + dy * dy)
    if (d === 0) return
    this.odo += d
    this.lastX = x
    this.lastY = y
    if (this.odo - this.lastOdo >= this.sampleDist) {
      this.record(x, y, t)
      this.lastOdo = this.odo
    }
  }

  private record(x: number, y: number, t: number) {
    if (this.count < this.maxPoints) {
      const i = this.count++
      this.xs[i] = x
      this.ys[i] = y
      this.ts[i] = t
    } else {
      // 已满：覆写最旧槽位（head），head 前移指向新的最旧点
      const i = this.head
      this.xs[i] = x
      this.ys[i] = y
      this.ts[i] = t
      this.head = (this.head + 1) % this.maxPoints
    }
  }

  private indexOf(k: number): number {
    return this.count < this.maxPoints ? k : (this.head + k) % this.maxPoints
  }

  xAt(k: number): number {
    return this.xs[this.indexOf(k)]
  }

  yAt(k: number): number {
    return this.ys[this.indexOf(k)]
  }

  tAt(k: number): number {
    return this.ts[this.indexOf(k)]
  }

  pointAt(k: number): { x: number; y: number; t: number } {
    const i = this.indexOf(k)
    return { x: this.xs[i], y: this.ys[i], t: this.ts[i] }
  }

  /** 轨迹点当前的存留比例：1 最新，≤0 应丢弃（已过 fadeTime 秒）。 */
  retentionAt(k: number): number {
    const r = 1 - (this.time - this.tAt(k)) / this.fadeTime
    return r < 0 ? 0 : r > 1 ? 1 : r
  }

  clear() {
    this.count = 0
    this.head = 0
    this.time = 0
    this.odo = 0
    this.lastOdo = 0
    this.lastX = Number.NaN
    this.lastY = Number.NaN
  }
}
