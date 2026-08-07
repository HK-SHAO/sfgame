import type { SourcePlacement } from './types'
import { LEVELS } from './levels'

// 参考解数据源：dev 模式首页关卡项直达摆法（solutionsFor）；可通关性与 winTime 由玩家实测
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
