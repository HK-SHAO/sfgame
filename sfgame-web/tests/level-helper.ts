import { LEVELS } from '../src/game/levels'

/** 按 id 取关卡（避免 tests 与 levels.ts 的导出顺序耦合） */
export const LEVEL_3 = LEVELS.find((l) => l.id === 3)!
export const LEVEL_4 = LEVELS.find((l) => l.id === 4)!
export const LEVEL_5 = LEVELS.find((l) => l.id === 5)!
