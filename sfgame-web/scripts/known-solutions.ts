// 全部关卡的已知解（序列化入库）：回归验证基线 + --refine 进一步优化种子。
// 全部经 dt=1/60 精筛验证通关、坐标 1 位小数（URL 可放置）；指标为精筛实测值。
// 质量只看总耗时（通关时间 + 源罚 4s/个 + 贴地罚 1s/s，罚时与游戏同源见 app/game/timer.ts），不比路程。
// URL 直达用 solutionUrl() 生成（与游戏 state.ts 的 s= 编码逐字符同构）。
import type { SourceTuple } from './solve-lib.ts'
import { sourceItem } from '../app/game/state.ts'

export interface KnownSolution {
  src: SourceTuple[]
  time: number
  groundTime: number
  total: number
}

export const KNOWN_SOLUTIONS: Record<string, KnownSolution> = {
  'luo-yu': { src: [[46, 49.3, 'hot']], time: 17.92, groundTime: 0, total: 21.92 },
  'fu-yao': { src: [[62, 20.3, 'hot'], [38, 30.1, 'cold']], time: 23.4, groundTime: 3.7, total: 35.1 },
  'xin-feng': { src: [[8, 29.3, 'hot']], time: 77.9, groundTime: 12.9, total: 94.7 },
  'chao-xi': { src: [[30.2, 28.2, 'hot']], time: 45.0, groundTime: 0, total: 49.0 },
  'hui-gui': { src: [[50, 12.2, 'cold'], [10, 14, 'cold']], time: 17.5, groundTime: 8.7, total: 34.2 },
  'ying-huo': { src: [[38, 20.3, 'cold']], time: 28.2, groundTime: 0, total: 32.2 },
  'bing-jiao': { src: [[18, 14.5, 'cold']], time: 32.0, groundTime: 0, total: 36.0 },
  'gu-feng': { src: [[54, 18.3, 'cold'], [44, 33.3, 'hot']], time: 11.55, groundTime: 0, total: 19.55 },
  'zhong-bai': { src: [[22, 19, 'hot']], time: 9.53, groundTime: 0, total: 13.53 },
  'fen-feng': { src: [[58, 17.2, 'hot']], time: 21.15, groundTime: 2.72, total: 27.87 },
  'chu-shuang': { src: [[40, 40.2, 'hot']], time: 30.5, groundTime: 1.4, total: 35.8 },
  'ni-lu': { src: [[26, 19.6, 'cold']], time: 67.8, groundTime: 46.6, total: 118.4 },
  'ji-bai': { src: [[28, 22, 'hot']], time: 19.0, groundTime: 0, total: 23.0 },
  'zhuo-yuan': { src: [[64, 25.9, 'hot']], time: 19.13, groundTime: 0.57, total: 23.7 },
  'tian-qian': { src: [[61.9, 3.5, 'cold']], time: 97.7, groundTime: 54.0, total: 155.7 },
  'zhui-xing': { src: [[96, 44, 'cold'], [28, 52, 'hot'], [78, 26.8, 'hot']], time: 40.8, groundTime: 0.7, total: 53.5 },
  'hui-yin': { src: [[20, 50, 'hot'], [70, 21.3, 'cold'], [20, 42, 'hot']], time: 50, groundTime: 0, total: 62 },
  'tian-ti': { src: [[92, 44, 'hot'], [16, 59.3, 'hot'], [82, 59.3, 'cold'], [62, 52, 'hot']], time: 54, groundTime: 0.2, total: 70.2 },
  'chuan-tang': { src: [[66, 46, 'cold'], [70, 19.8, 'hot'], [70, 27.8, 'hot']], time: 37.2, groundTime: 9.9, total: 59.1 },
}

// s= URL 直达参数（如 ?lv=1&s=46-49.3-h）：复用游戏 URL 编码（坐标 1 位小数、整数去 .0）
export function solutionUrl(src: SourceTuple[]): string {
  return src.map((s) => sourceItem.encode({ x: s[0], y: s[1], kind: s[2] })).join('_')
}
