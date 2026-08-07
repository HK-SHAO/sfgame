import { sourceItem } from './state'
import type { SourcePlacement } from './types'
import { LEVELS } from './levels'

// 所有解均 t=0 一次性放置完毕（实测分散放置反而更慢）；winTime 为无头实测值，由 tests/solutions.test.ts 守护
export interface LevelSolution {
  name: string
  sources: SourcePlacement[]
  winTime: number
}

export const SOLUTIONS: Record<number, LevelSolution[]> = Object.fromEntries(
  LEVELS.map((l) => [l.id, (l.json.solutions ?? []).map((s) => ({ ...s }))]),
)

export function solutionsFor(levelId: number): LevelSolution[] {
  return SOLUTIONS[levelId] ?? []
}

// 以 base 为底只换 lv/src，dev 等其他状态原样保留；v 优先于 lv，直达必须清掉否则停在解法参考页
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
