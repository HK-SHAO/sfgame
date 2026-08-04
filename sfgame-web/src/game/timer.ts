/**
 * 计时与罚时模块（无头可测，UI 与模拟层共用同一套定义）：
 * - 模拟耗时：关卡内物理时间（倍速下自然加速），通关后冻结
 * - 罚时：按当前场上源数计费，鼓励用更少的源；移除源即减免
 * 展示格式统一由本模块提供（formatTime / formatPenalty），避免 UI 各自拼串。
 */

/** 每放置一个源的惩罚性耗时（秒）：叠加在通关总耗时上，鼓励用更少的源。
 * 关卡预算 4 热 2 冷（最多 6 源）：3 源基准解 30.3s → 总 42.3s（+39%），
 * 少用源的快解明显更优，但惩罚温和、不否定"多源兜底"的容错打法。 */
export const SOURCE_PENALTY = 4

/** 罚时（秒）：按当前场上源数线性计费 */
export function penaltySeconds(sources: number): number {
  return sources * SOURCE_PENALTY
}

/** 秒 → 显示文本（1 位小数，等宽数字布局） */
export function formatTime(seconds: number): string {
  return `${seconds.toFixed(1)}s`
}

/** 罚时显示文本：无罚时显示"无"，有罚时带 + 号 */
export function formatPenalty(seconds: number): string {
  return seconds > 0 ? `+${seconds.toFixed(1)}s` : '无'
}
