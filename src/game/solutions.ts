import { sourceItem } from './state'
import type { SourcePlacement } from './types'

/**
 * 关卡解法注册表（开发者参考页数据源）。
 * 所有解均只考虑"初始状态一次性放置完毕"：全部源在 t=0 同时生效、无先后顺序
 * （实测：分散放置反而更慢，且初学关应允许玩家观察飞机后再操作）。
 * winTime 为无头确定性模拟实测值，由 tests/solutions.test.ts 守护。
 */
export interface LevelSolution {
  /** 解名（简短） */
  name: string
  /** 初始一次性放置的全部源 */
  sources: SourcePlacement[]
  /** 无头实测通关时刻（秒） */
  winTime: number
  /** 思路一句话 */
  note: string
}

export const LEVEL_1_SOLUTIONS: LevelSolution[] = [
  {
    name: '四源稳过',
    sources: [
      { x: 20, y: 44, kind: 'hot' },
      { x: 36, y: 28, kind: 'hot' },
      { x: 50, y: 16, kind: 'hot' },
      { x: 58, y: 14, kind: 'hot' },
    ],
    winTime: 21.6,
    note: '谷底托起 → 崖脚接力 → 崖顶推进 → 目标前托举',
  },
  {
    name: '三源精简',
    sources: [
      { x: 20, y: 44, kind: 'hot' },
      { x: 36, y: 28, kind: 'hot' },
      { x: 50, y: 16, kind: 'hot' },
    ],
    winTime: 30.3,
    note: '省掉目标前托举，热浪顺谷风送飞机最后一段',
  },
]

/** 关卡 → 解列表；未知关卡返回空数组。 */
export const SOLUTIONS: Record<number, LevelSolution[]> = {
  1: LEVEL_1_SOLUTIONS,
}

export function solutionsFor(levelId: number): LevelSolution[] {
  return SOLUTIONS[levelId] ?? []
}

/** 解 → 进入游戏的相对 URL（与 URL 状态模块同构，点击即可直达该摆放）。 */
export function solutionUrl(levelId: number, sol: LevelSolution): string {
  return `?level=${levelId}&sources=${sol.sources.map((s) => sourceItem.encode(s)).join('_')}`
}
