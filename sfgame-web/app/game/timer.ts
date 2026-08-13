// 罚时取舍：少用源明显更优但惩罚温和（参考解 2 源 +8s、兜底 4 源 +16s），不否定"多源容错"打法
export const SOURCE_PENALTY = 4

// 贴地罚时：每秒贴地（离地 <1）追加 1s——爬行/贴地滑行是"慢的伪装"，物理时间照常走、罚时同步涨
export const GROUND_PENALTY_RATE = 1

// 贴地判定阈值（SDF 高度）：simulation.groundedTime 与求解器同源的口径单点
export const GROUNDED_ALT = 1

export function penaltySeconds(sources: number): number {
  return sources * SOURCE_PENALTY
}

// 总罚时 = 源数罚时 + 贴地罚时（贴地秒数按物理时间实时累计）
export function totalPenaltySeconds(sources: number, groundedSeconds: number): number {
  return sources * SOURCE_PENALTY + groundedSeconds * GROUND_PENALTY_RATE
}

export function formatTime(seconds: number): string {
  return `${seconds.toFixed(1)}s`
}

export function formatPenalty(seconds: number): string {
  return seconds > 0 ? `+${seconds.toFixed(1)}s` : '无'
}
