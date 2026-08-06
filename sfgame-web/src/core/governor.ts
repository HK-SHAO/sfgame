// 自适应降级：帧成本 EMA + 持续慢帧计数，先降粒子档到底再降 dpr（GPU 化后粒子是剩余 CPU 大头）。
// 预算随速率放大（倍速慢帧是预期，且流体成本不可降级）；偶发卡顿不触发（150 帧容错）
export const TRACER_TIERS = [400, 320, 240, 180, 128, 96]
export const COARSE_TRACER_TIER = 2
export const DPR_TIERS_COARSE = [2, 1.5, 1.0]
export const DPR_TIERS_FINE = [2, 1.5]

export type DegradeAction = 'tracer' | 'dpr'

export interface GovernorOptions {
  initialTracerLevel?: number
  budgetMs?: number
  emaSmooth?: number
  slowFrames?: number
}

export class PerformanceGovernor {
  readonly tracerTiers: number[]
  readonly dprTiers: number[]
  private budgetMs: number
  private emaSmooth: number
  private slowFramesLimit: number
  private _tracerLevel: number
  private _dprTier = 0
  private frameEma = 0
  private slowFrames = 0

  constructor(tracerTiers: number[], dprTiers: number[], opts: GovernorOptions = {}) {
    this.tracerTiers = tracerTiers
    this.dprTiers = dprTiers
    this._tracerLevel = opts.initialTracerLevel ?? 0
    this.budgetMs = opts.budgetMs ?? 13
    this.emaSmooth = opts.emaSmooth ?? 0.95
    this.slowFramesLimit = opts.slowFrames ?? 150
  }

  get tracerLevel() {
    return this._tracerLevel
  }

  get dprTier() {
    return this._dprTier
  }

  // 每帧上报成本与速率；持续超预算时返回应降的档（tracer 到底后转 dpr），无动作为 null
  record(costMs: number, rate: number): DegradeAction | null {
    this.frameEma =
      this.frameEma === 0 ? costMs : this.frameEma * this.emaSmooth + costMs * (1 - this.emaSmooth)
    if (this.frameEma <= this.budgetMs * Math.max(1, rate)) {
      this.slowFrames = 0
      return null
    }
    if (++this.slowFrames <= this.slowFramesLimit) return null
    this.slowFrames = 0
    if (this._tracerLevel < this.tracerTiers.length - 1) {
      this._tracerLevel++
      return 'tracer'
    }
    if (this._dprTier < this.dprTiers.length - 1) {
      this._dprTier++
      return 'dpr'
    }
    return null
  }

  // 无 DOM：设备 dpr 由调用方注入
  pixelRatio(deviceDpr: number): number {
    return Math.min(deviceDpr || 1, this.dprTiers[this._dprTier])
  }
}
