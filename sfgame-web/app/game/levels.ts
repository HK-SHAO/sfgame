import { levelFromJson, parseLevelText } from './level-format'
import type { LvValue } from './state'
import type { LevelDef, LevelJson, SolutionDef } from './types'
// YAML 经 ?raw 直读（vite 原生支持、随文件变更触发 HMR），解析在运行时统一走 parseLevelText——无需虚拟模块/构建插件
import level1 from '../../levels/level-1.yaml?raw'
import level2 from '../../levels/level-2.yaml?raw'
import level3 from '../../levels/level-3.yaml?raw'
import level4 from '../../levels/level-4.yaml?raw'
import level5 from '../../levels/level-5.yaml?raw'
import level6 from '../../levels/level-6.yaml?raw'
import level7 from '../../levels/level-7.yaml?raw'
import level8 from '../../levels/level-8.yaml?raw'
import level9 from '../../levels/level-9.yaml?raw'
import level10 from '../../levels/level-10.yaml?raw'

const LEVEL_TEXTS = [level1, level2, level3, level4, level5, level6, level7, level8, level9, level10]

// 关卡图（主页选项卡 + 解锁/导航的单一事实来源）：组内顺序 = ids 数组顺序，
// YAML 只承载关卡内容，不再声明归属
export interface LevelGroup {
  name: string
  ids: readonly number[]
}

export const LEVEL_GROUPS: LevelGroup[] = [
  { name: '长风', ids: [1, 2, 3, 4, 5] },
  { name: '焚风', ids: [6, 7, 8, 9, 10] },
]

// 逐关容错加载：坏关卡只进 LEVEL_ERRORS 清单，绝不抛错——模块加载抛错会让整个 bundle 求值失败 → 应用白屏
export const LEVEL_ERRORS: string[] = []
export const LEVELS_BY_ID = new Map<number, LevelDef>()
export const LEVEL_SOURCES = new Map<number, string>()
export function levelSource(id: number): string | undefined {
  return LEVEL_SOURCES.get(id)
}
for (const text of LEVEL_TEXTS) {
  try {
    // parseLevelText 已校验，levelFromJson 跳过重复校验（启动路径省一半校验开销）
    const level = levelFromJson(parseLevelText(text), true)
    LEVELS_BY_ID.set(level.id, level)
    LEVEL_SOURCES.set(level.id, text)
  } catch (e) {
    LEVEL_ERRORS.push(e instanceof Error ? e.message : String(e))
  }
}

// 按图序展开：组序 + 组内序（缺关卡跳过），与解锁/导航顺序一致
export const LEVELS: LevelDef[] = LEVEL_GROUPS.flatMap((g) =>
  g.ids.map((id) => LEVELS_BY_ID.get(id)).filter((l): l is LevelDef => l !== undefined),
)

function groupOf(id: number): LevelGroup | undefined {
  return LEVEL_GROUPS.find((g) => g.ids.includes(id))
}

// 组内下一关（组尾无下一关）
export function nextInGroup(id: number): number | undefined {
  const g = groupOf(id)
  if (!g) return undefined
  const i = g.ids.indexOf(id)
  return i >= 0 ? g.ids[i + 1] : undefined
}

// 解锁语义：每组第一关初始解锁，其余 = 完成组内前驱；跨组独立
export function isUnlocked(id: number, completed: (id: number) => boolean): boolean {
  const g = groupOf(id)
  if (!g) return false
  const i = g.ids.indexOf(id)
  return i <= 0 ? i === 0 : completed(g.ids[i - 1])
}

// lv 双形态解析：数字 = 内置关卡；字符串 = URL 内联关卡 JSON（state.ts 编解码，解析失败视为无效）。
// 数字分支走 LEVELS_BY_ID（O(1)，与 solutionsFor 同源）；字符串为外部输入必须完整校验
export function resolveLevel(lv: LvValue): LevelDef | undefined {
  if (typeof lv === 'number') return LEVELS_BY_ID.get(lv)
  if (typeof lv === 'string') {
    try {
      return levelFromJson(JSON.parse(lv) as LevelJson)
    } catch {
      return undefined
    }
  }
  return undefined
}

// 参考解数据源：dev 模式首页关卡项直达摆法；可通关性与 winTime 由玩家实测
export function solutionsFor(levelId: number): SolutionDef[] {
  return LEVELS_BY_ID.get(levelId)?.json.solutions ?? []
}
