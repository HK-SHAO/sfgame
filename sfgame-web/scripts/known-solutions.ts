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
  'fu-yao': { src: [[62, 20.3, 'hot'], [38, 30.1, 'cold']], time: 17.67, groundTime: 1.83, total: 27.5 },
  'xin-feng': { src: [[19.5, 15.5, 'cold']], time: 13.98, groundTime: 0, total: 17.98 },
  'chao-xi': { src: [[30.2, 28.2, 'hot']], time: 41.03, groundTime: 0, total: 45.03 },
  'hui-gui': { src: [[22.9, 30.1, 'hot'], [11, 9.7, 'cold']], time: 29.4, groundTime: 9.0, total: 46.4 },
  'ying-huo': { src: [[38, 20.3, 'cold']], time: 28.2, groundTime: 0, total: 32.2 },
  'bing-jiao': { src: [[46, 41.3, 'cold']], time: 44.7, groundTime: 2.8, total: 51.4 },
  'gu-feng': { src: [[54, 18.3, 'cold'], [44, 33.3, 'hot']], time: 11.55, groundTime: 0, total: 19.55 },
  'zhong-bai': { src: [[22, 19, 'hot']], time: 9.53, groundTime: 0, total: 13.53 },
  'fen-feng': { src: [[58, 17.2, 'hot']], time: 21.15, groundTime: 2.72, total: 27.87 },
  'chu-shuang': { src: [[40, 40.2, 'hot']], time: 30.5, groundTime: 1.4, total: 35.8 },
  'ni-lu': { src: [[34, 21.6, 'hot']], time: 38.3, groundTime: 18.4, total: 60.6 },
  'ji-bai': { src: [[41, 26.3, 'hot']], time: 13.8, groundTime: 0, total: 17.8 },
  'zhuo-yuan': { src: [[64, 25.9, 'hot']], time: 19.13, groundTime: 0.57, total: 23.7 },
  'tian-qian': { src: [[61.9, 3.5, 'cold']], time: 72.1, groundTime: 21.8, total: 97.9 },
  'zhui-xing': { src: [[70, 44, 'hot'], [38, 59.3, 'hot'], [66, 44, 'hot']], time: 77.1, groundTime: 23.3, total: 112.4 },
  'hui-yin': { src: [[20, 50, 'hot'], [70, 21.3, 'cold'], [20, 42, 'hot']], time: 50, groundTime: 0, total: 62 },
  'tian-ti': { src: [[92, 44, 'hot'], [16, 59.3, 'hot'], [82, 59.3, 'cold'], [62, 52, 'hot']], time: 54, groundTime: 0.2, total: 70.2 },
  'chuan-tang': { src: [[66, 46, 'cold'], [70, 19.8, 'hot'], [70, 27.8, 'hot']], time: 37.2, groundTime: 9.9, total: 59.1 },
  'gui-xu': { src: [[46, 46, 'cold'], [26, 6, 'hot'], [18, 46, 'hot']], time: 73.4, groundTime: 14.1, total: 99.5 },
}

// s= URL 直达参数（如 ?lv=1&s=46-49.3-h）：复用游戏 URL 编码（坐标 1 位小数、整数去 .0）
export function solutionUrl(src: SourceTuple[]): string {
  return src.map((s) => sourceItem.encode({ x: s[0], y: s[1], kind: s[2] })).join('_')
}
