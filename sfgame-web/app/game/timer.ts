// 罚时取舍：少用源明显更优但惩罚温和（参考解 2 源 +8s、兜底 4 源 +16s），不否定"多源容错"打法
export const SOURCE_PENALTY = 4

export function penaltySeconds(sources: number): number {
  return sources * SOURCE_PENALTY
}

export function formatTime(seconds: number): string {
  return `${seconds.toFixed(1)}s`
}

export function formatPenalty(seconds: number): string {
  return seconds > 0 ? `+${seconds.toFixed(1)}s` : '无'
}
