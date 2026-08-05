/** 计时与罚时（UI 与模拟层共用同一套定义，避免各自拼串）。 */

/** 每放置一个源的罚时（秒），叠加在通关总耗时上：少用源明显更优，
 * 但惩罚温和（参考解 2 源 +8s、兜底 4 源 +16s），不否定"多源容错"的打法。 */
export const SOURCE_PENALTY = 4

export function penaltySeconds(sources: number): number {
  return sources * SOURCE_PENALTY
}

export function formatTime(seconds: number): string {
  return `${seconds.toFixed(1)}s`
}

/** 无罚时显示"无"，有罚时带 + 号 */
export function formatPenalty(seconds: number): string {
  return seconds > 0 ? `+${seconds.toFixed(1)}s` : '无'
}
