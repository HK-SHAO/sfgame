// 自适应降级：帧成本 EMA + 持续慢帧计数。粒子数恒定（全平台视觉一致，粒子是核心视觉不是可降项），
// 兜底只降 dpr 分辨率档（iOS Metal/弱 GPU 的负担主要在 GPU 侧，降粒子无益）。预算随速率放大
// （倍速慢帧是预期，且流体成本不可降级）；偶发卡顿不触发（150 帧容错）
export const DPR_TIERS = [2, 1.5]

export interface GovernorOptions {
  budgetMs?: number
  emaSmooth?: number
  slowFrames?: number
}

export class PerformanceGovernor {
  readonly dprTiers: number[]
  private budgetMs: number
  private emaSmooth: number
  private slowFramesLimit: number
  private _dprTier = 0
  private frameEma = 0
  private slowFrames = 0

  constructor(dprTiers: number[], opts: GovernorOptions = {}) {
    this.dprTiers = dprTiers
    this.budgetMs = opts.budgetMs ?? 13
    this.emaSmooth = opts.emaSmooth ?? 0.95
    this.slowFramesLimit = opts.slowFrames ?? 150
  }

  get dprTier() {
    return this._dprTier
  }

  record(costMs: number, rate: number): boolean {
    this.frameEma =
      this.frameEma === 0 ? costMs : this.frameEma * this.emaSmooth + costMs * (1 - this.emaSmooth)
    if (this.frameEma <= this.budgetMs * Math.max(1, rate)) {
      this.slowFrames = 0
      return false
    }
    if (++this.slowFrames <= this.slowFramesLimit) return false
    this.slowFrames = 0
    if (this._dprTier < this.dprTiers.length - 1) {
      this._dprTier++
      return true
    }
    return false
  }

  // 无 DOM：设备 dpr 由调用方注入
  pixelRatio(deviceDpr: number): number {
    return Math.min(deviceDpr || 1, this.dprTiers[this._dprTier])
  }
}

// 全局单例（与 bgm/fb/progress 同模式）：降级档须跨关卡延续——设备能力不随关卡重建，
// 每关新建实例会把 tier 归零，弱设备每关重新掉帧 150 帧后才降级
export const governor = new PerformanceGovernor(DPR_TIERS)
