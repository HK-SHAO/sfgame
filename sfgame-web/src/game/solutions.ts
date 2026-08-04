import { sourceItem } from './state'
import type { SourcePlacement } from './types'

/**
 * 关卡解法注册表（解法参考页数据源）。
 * 所有解均只考虑"初始状态一次性放置完毕"：全部源在 t=0 同时生效、无先后顺序
 * （实测：分散放置反而更慢，且初学关应允许玩家观察飞机后再操作）。
 * 每关保留一个最优解；winTime 为无头确定性模拟实测值，由 tests/solutions.test.ts 守护。
 */
export interface LevelSolution {
  name: string
  sources: SourcePlacement[]
  /** 无头实测通关时刻（秒） */
  winTime: number
}

export const LEVEL_1_SOLUTIONS: LevelSolution[] = [
  {
    name: '三源接力借谷风',
    sources: [
      { x: 20, y: 44, kind: 'hot' },
      { x: 36, y: 28, kind: 'hot' },
      { x: 50, y: 16, kind: 'hot' },
    ],
    winTime: 30.3,
  },
]

export const LEVEL_2_SOLUTIONS: LevelSolution[] = [
  {
    name: '冷源两段下沉压',
    sources: [
      { x: 50, y: 24, kind: 'cold' },
      { x: 60, y: 32, kind: 'cold' },
    ],
    winTime: 19.6,
  },
]

/** 关卡 → 解列表；未知关卡返回空数组。 */
export const SOLUTIONS: Record<number, LevelSolution[]> = {
  1: LEVEL_1_SOLUTIONS,
  2: LEVEL_2_SOLUTIONS,
}

export function solutionsFor(levelId: number): LevelSolution[] {
  return SOLUTIONS[levelId] ?? []
}

/** 解 → 进入游戏的相对 URL（与 URL 状态模块同构，点击即可直达该摆放）。 */
export function solutionUrl(levelId: number, sol: LevelSolution): string {
  return `?level=${levelId}&sources=${sol.sources.map((s) => sourceItem.encode(s)).join('_')}`
}
