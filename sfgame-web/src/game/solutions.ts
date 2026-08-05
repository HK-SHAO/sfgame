import { sourceItem } from './state'
import type { SourcePlacement } from './types'
import { LEVELS } from './levels'

/**
 * 所有解均"初始一次性放置完毕"（t=0 同时生效、无先后顺序——实测分散放置反而更慢）。
 * 数据源为关卡 JSON 内嵌的 solutions；winTime 为无头实测值，由 tests/solutions.test.ts 守护。
 */
export interface LevelSolution {
  name: string
  sources: SourcePlacement[]
  /** 无头实测通关时刻（秒） */
  winTime: number
}

/** 未知关卡返回空数组。 */
export const SOLUTIONS: Record<number, LevelSolution[]> = Object.fromEntries(
  LEVELS.map((l) => [l.id, (l.json.solutions ?? []).map((s) => ({ ...s }))]),
)

export function solutionsFor(levelId: number): LevelSolution[] {
  return SOLUTIONS[levelId] ?? []
}

/** 相对 URL：与 URL 状态模块同构，点击即可直达该摆放。 */
export function solutionUrl(levelId: number, sol: LevelSolution): string {
  return `?lv=${levelId}&src=${sol.sources.map((s) => sourceItem.encode(s)).join('_')}`
}
