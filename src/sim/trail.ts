/**
 * 路程驱动的拖尾轨迹（拉格日记录）。
 *
 * 与"按时间淡出"的常规拖尾不同：每个轨迹点记录写入时的里程表（odometer），
 * 淡出程度 = 物体自该点之后走过的路程 / fadeDist。
 * 由此物体停住时可见轨迹不会消失，运动越快旧轨迹被"甩掉"得越干脆。
 *
 * 环形缓冲、等距采样（每走过 sampleDist 记一点），无 DOM 依赖，可无头测试。
 */
export class Trail {
  readonly maxPoints: number
  readonly sampleDist: number
  readonly fadeDist: number
  /** 累计路程（世界单位） */
  odometer = 0
  /** 缓冲中的点数（≤ maxPoints） */
  count = 0

  private xs: Float32Array
  private ys: Float32Array
  /** 各点写入时的里程 */
  private os: Float32Array
  private head = 0
  private lastX = Number.NaN
  private lastY = Number.NaN
  private lastOdo = 0

  constructor(maxPoints: number, sampleDist: number, fadeDist: number) {
    this.maxPoints = maxPoints
    this.sampleDist = sampleDist
    this.fadeDist = fadeDist
    this.xs = new Float32Array(maxPoints)
    this.ys = new Float32Array(maxPoints)
    this.os = new Float32Array(maxPoints)
  }

  /** 记录物体当前位置；路程未达采样间隔则只推进里程表。 */
  push(x: number, y: number) {
    if (Number.isNaN(this.lastX)) {
      this.lastX = x
      this.lastY = y
      this.record(x, y)
      return
    }
    const d = Math.hypot(x - this.lastX, y - this.lastY)
    if (d === 0) return
    this.odometer += d
    this.lastX = x
    this.lastY = y
    if (this.odometer - this.lastOdo >= this.sampleDist) this.record(x, y)
  }

  private record(x: number, y: number) {
    if (this.count < this.maxPoints) {
      const i = this.count++
      this.xs[i] = x
      this.ys[i] = y
      this.os[i] = this.odometer
    } else {
      // 已满：覆写最旧槽位（head），head 前移指向新的最旧点
      const i = this.head
      this.xs[i] = x
      this.ys[i] = y
      this.os[i] = this.odometer
      this.head = (this.head + 1) % this.maxPoints
    }
    this.lastOdo = this.odometer
  }

  private indexOf(k: number): number {
    return this.count < this.maxPoints ? k : (this.head + k) % this.maxPoints
  }

  /** 第 k 个点（从旧到新，0 起）的横坐标。 */
  xAt(k: number): number {
    return this.xs[this.indexOf(k)]
  }

  /** 第 k 个点（从旧到新，0 起）的纵坐标。 */
  yAt(k: number): number {
    return this.ys[this.indexOf(k)]
  }

  /** 第 k 个点写入时的里程。 */
  odoAt(k: number): number {
    return this.os[this.indexOf(k)]
  }

  /** 按从旧到新取第 k 个点的坐标与写入时里程。 */
  pointAt(k: number): { x: number; y: number; odo: number } {
    const i = this.indexOf(k)
    return { x: this.xs[i], y: this.ys[i], odo: this.os[i] }
  }

  /** 轨迹点当前的存留比例：1 最新，≤0 应丢弃（物体已走过 fadeDist 以上）。 */
  retentionAt(k: number): number {
    const r = 1 - (this.odometer - this.odoAt(k)) / this.fadeDist
    return r < 0 ? 0 : r > 1 ? 1 : r
  }

  clear() {
    this.count = 0
    this.head = 0
    this.odometer = 0
    this.lastOdo = 0
    this.lastX = Number.NaN
    this.lastY = Number.NaN
  }
}
