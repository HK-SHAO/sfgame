// 全部关卡的已知解（序列化入库）：回归验证基线 + --refine 进一步优化种子。
// 全部经 dt=1/60 精筛验证通关、坐标 1 位小数（URL 可放置）；指标为精筛实测值。
// 质量只看总耗时（通关时间 + 源罚 4s/个 + 贴地罚 1s/s，罚时与游戏同源见 app/game/timer.ts），不比路程。
// URL 直达用 solutionUrl() 生成（与游戏 state.ts 的 s= 编码逐字符同构）。
import type { SourceTuple } from './solve-lib'
import { sourceItem } from '../app/game/state'

export interface KnownSolution {
  src: SourceTuple[]
  time: number
  groundTime: number
  total: number
}

export const KNOWN_SOLUTIONS: Record<number, KnownSolution> = {
  1: { src: [[46, 49.3, 'hot']], time: 17.92, groundTime: 0, total: 21.92 },
  2: { src: [[62, 20.3, 'hot'], [38, 30.1, 'cold']], time: 17.67, groundTime: 1.83, total: 27.5 },
  3: { src: [[19.5, 15.5, 'cold']], time: 13.98, groundTime: 0, total: 17.98 },
  4: { src: [[30.2, 28.2, 'hot']], time: 41.03, groundTime: 0, total: 45.03 },
  5: { src: [[22.9, 28.1, 'hot'], [11, 9.7, 'cold'], [34.9, 23.2, 'hot']], time: 17.27, groundTime: 9.6, total: 38.87 },
  6: { src: [[38, 16.1, 'cold']], time: 18.4, groundTime: 1.95, total: 24.35 },
  7: { src: [[48, 19.8, 'cold']], time: 15.08, groundTime: 0.22, total: 19.3 },
  8: { src: [[54, 18.3, 'cold'], [44, 33.3, 'hot']], time: 11.55, groundTime: 0, total: 19.55 },
  9: { src: [[22, 19, 'hot']], time: 9.53, groundTime: 0, total: 13.53 },
  10: { src: [[58, 17.2, 'hot']], time: 21.15, groundTime: 2.72, total: 27.87 },
  11: { src: [[26, 47.3, 'hot']], time: 22.4, groundTime: 3.33, total: 29.73 },
  12: { src: [[34, 23.8, 'hot'], [34, 14.8, 'cold']], time: 11.62, groundTime: 0.7, total: 20.32 },
  13: { src: [[42, 26.3, 'hot']], time: 13.05, groundTime: 0.73, total: 17.78 },
  14: { src: [[64, 25.9, 'hot']], time: 19.13, groundTime: 0.57, total: 23.7 },
  15: { src: [[62, 4, 'cold']], time: 32.98, groundTime: 10.4, total: 47.38 },
}

// s= URL 直达参数（如 ?lv=1&s=46-49.3-h）：复用游戏 URL 编码（坐标 1 位小数、整数去 .0）
export function solutionUrl(src: SourceTuple[]): string {
  return src.map((s) => sourceItem.encode({ x: s[0], y: s[1], kind: s[2] })).join('_')
}
