import { levelFromJson, parseLevelText } from './level-format'
import type { LvValue } from './state'
import type { LevelDef, LevelJson } from './types'
// 关卡 JSON 经 ?raw 直读（vite 原生支持、随文件变更触发 HMR），解析在运行时统一走 parseLevelText——无需虚拟模块/构建插件
import level1 from '../../levels/level-1.json?raw'
import level2 from '../../levels/level-2.json?raw'
import level3 from '../../levels/level-3.json?raw'
import level4 from '../../levels/level-4.json?raw'
import level5 from '../../levels/level-5.json?raw'
import level6 from '../../levels/level-6.json?raw'
import level7 from '../../levels/level-7.json?raw'
import level8 from '../../levels/level-8.json?raw'
import level9 from '../../levels/level-9.json?raw'
import level10 from '../../levels/level-10.json?raw'
import level11 from '../../levels/level-11.json?raw'
import level12 from '../../levels/level-12.json?raw'
import level13 from '../../levels/level-13.json?raw'
import level14 from '../../levels/level-14.json?raw'
import level15 from '../../levels/level-15.json?raw'

const LEVEL_TEXTS = [
  level1, level2, level3, level4, level5, level6, level7, level8, level9, level10,
  level11, level12, level13, level14, level15,
]

// 关卡图（主页选项卡 + 解锁/导航的单一事实来源）：JSON 不声明归属，组内顺序 = ids 数组顺序
export interface LevelGroup {
  name: string
  ids: readonly number[]
}

export const LEVEL_GROUPS: LevelGroup[] = [
  { name: '长风', ids: [1, 2, 3, 4, 5] },
  { name: '焚风', ids: [6, 7, 8, 9, 10] },
  // 第三组：既有图调参的硬核重编（环境温度原子主登场），组内按难度升序
  { name: '烈风', ids: [11, 12, 13, 14, 15] },
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

// 按图序展开（缺关卡跳过）：与解锁/导航顺序一致
export const LEVELS: LevelDef[] = LEVEL_GROUPS.flatMap((g) =>
  g.ids.map((id) => LEVELS_BY_ID.get(id)).filter((l): l is LevelDef => l !== undefined),
)

function groupOf(id: number): LevelGroup | undefined {
  return LEVEL_GROUPS.find((g) => g.ids.includes(id))
}

// 下一关：组内顺延，组尾跨入下一组首关，最后一关无下一关
export function nextLevel(id: number): number | undefined {
  const idx = LEVELS.findIndex((l) => l.id === id)
  return idx >= 0 ? LEVELS[idx + 1]?.id : undefined
}

// 解锁语义：每组第一关初始解锁，其余 = 上一关或本关已有过关记录；跨组独立
export function isUnlocked(id: number, completed: (id: number) => boolean): boolean {
  const g = groupOf(id)
  if (!g) return false
  const i = g.ids.indexOf(id)
  if (i <= 0) return i === 0
  return completed(g.ids[i - 1]) || completed(id)
}

// lv 双形态解析：数字 = 内置关卡；字符串 = URL 内联 JSON（解析失败视为无效，外部输入须完整校验）
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

// FNV-1a 32bit：关卡内容 → 短 hash（base36）。玩家解法记录据此绑定（progress.ts）：
// 关卡改版 hash 变旧解自然失效；内联 DIY 关卡同 id 不同内容互不串号
function fnv1a(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

// 内置关卡 hash 源 = 关卡文件原文（LEVEL_SOURCES）；内联 = URL 里的 JSON 文本本身
export function levelHash(lv: LvValue): string | undefined {
  const text = typeof lv === 'number' ? LEVEL_SOURCES.get(lv) : lv ?? undefined
  return text ? fnv1a(text) : undefined
}
