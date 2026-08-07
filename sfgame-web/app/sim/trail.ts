// 拖尾淡出约定（2026-08 起）：存留 = 1 − 距写入时刻 / 淡出时长，随时间淡出不随路程。
// 飞机拖尾与示踪粒子轨迹共用本函数（时间基均为 sim 时间）
export const fadeRetention = (t0: number, ts: number, fadeT: number): number => {
  const r = 1 - (t0 - ts) / fadeT
  return r < 0 ? 0 : r > 1 ? 1 : r
}

// 淡出时长：示踪粒子短轨迹 5s / 纸飞机拖尾 6s（视觉校准值）
export const TRAIL_FADE_T = 5
export const PLANE_TRAIL_FADE = 6

export class Trail {
  readonly maxPoints: number
  readonly sampleDist: number
  readonly fadeTime: number
  time = 0
  count = 0

  private xs: Float32Array
  private ys: Float32Array
  private ts: Float32Array
  private head = 0
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

  retentionAt(k: number): number {
    return fadeRetention(this.time, this.tAt(k), this.fadeTime)
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
