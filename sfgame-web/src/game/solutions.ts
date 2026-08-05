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

/**
 * 相对 URL：以 base（UI 层传入的当前查询参数）为底，只替换/新增 lv 与 src——
 * dev 等其他状态原样保留（点解法链接不丢状态）；v 为页面视图标记且优先于 lv，
 * 解法直达的目标是游戏视图，必须清掉，否则会停在解法参考页。
 * 与 URL 状态模块的 flush 同构（在当前参数上 set），点击即可直达该摆放。
 */
export function solutionUrl(
  levelId: number,
  sol: LevelSolution,
  base: URLSearchParams = new URLSearchParams(),
): string {
  const params = new URLSearchParams(base)
  params.set('lv', String(levelId))
  params.set('src', sol.sources.map((s) => sourceItem.encode(s)).join('_'))
  params.delete('v')
  return `?${params.toString()}`
}
