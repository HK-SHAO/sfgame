import { levelFromJson, parseLevelText } from './level-format.ts'
import type { LvValue } from './state.ts'
import type { LevelDef, LevelJson } from './types.ts'
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
import level16 from '../../levels/level-16.json?raw'
import level17 from '../../levels/level-17.json?raw'
import level18 from '../../levels/level-18.json?raw'
import level19 from '../../levels/level-19.json?raw'
import level20 from '../../levels/level-20.json?raw'

const LEVEL_TEXTS = [
  level1, level2, level3, level4, level5, level6, level7, level8, level9, level10,
  level11, level12, level13, level14, level15, level16, level17, level18, level19, level20,
]

// 关卡图（主页选项卡 + 解锁/导航的单一事实来源）：JSON 不声明归属，组内顺序 = ids 数组顺序
export interface LevelGroup {
  name: string
  ids: readonly string[]
}

export const LEVEL_GROUPS: LevelGroup[] = [
  { name: '长风', ids: ['luo-yu', 'fu-yao', 'xin-feng', 'chao-xi', 'hui-gui'] },
  { name: '焚风', ids: ['ying-huo', 'bing-jiao', 'gu-feng', 'zhong-bai', 'fen-feng'] },
  // 第三组：既有图调参的硬核重编（环境温度原子主登场），组内按难度升序
  { name: '烈风', ids: ['chu-shuang', 'ni-lu', 'ji-bai', 'zhuo-yuan', 'tian-qian'] },
  // 第四组：SDF 真原语新地形（浮石/隧道/石柱/深槽/拱窗），大地图高难长线
  { name: '罡风', ids: ['zhui-xing', 'hui-yin', 'tian-ti', 'chuan-tang', 'gui-xu'] },
]

// 逐关容错加载：坏关卡只进 LEVEL_ERRORS 清单，绝不抛错——模块加载抛错会让整个 bundle 求值失败 → 应用白屏
export const LEVEL_ERRORS: string[] = []
export const LEVELS_BY_ID = new Map<string, LevelDef>()
const LEVEL_SOURCES = new Map<string, string>()
export function levelSource(id: string): string | undefined {
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

function groupOf(id: string): LevelGroup | undefined {
  return LEVEL_GROUPS.find((g) => g.ids.includes(id))
}

// 下一关：组内顺延，组尾跨入下一组首关，最后一关无下一关
export function nextLevel(id: string): string | undefined {
  const idx = LEVELS.findIndex((l) => l.id === id)
  return idx >= 0 ? LEVELS[idx + 1]?.id : undefined
}

// 解锁语义：每组第一关初始解锁，其余 = 上一关或本关已有过关记录；跨组独立
export function isUnlocked(id: string, completed: (id: string) => boolean): boolean {
  const g = groupOf(id)
  if (!g) return false
  const i = g.ids.indexOf(id)
  if (i <= 0) return i === 0
  return completed(g.ids[i - 1]) || completed(id)
}

// lv 双形态解析：{ id } = 内置关卡；{ json } = URL 内联 JSON（解析失败视为无效，外部输入须完整校验）。
// {json} 单槽缓存：同文本重复派生（dev 确认/屏幕往返/popstate 重同步）免重复全量校验+全域烘焙，
// 且返回同一 LevelDef 身份——keyed(activeLevel) 不误重建（LevelDef 全链路不可变，共享安全）
let inlineJsonCache: string | undefined
let inlineLevelCache: LevelDef | undefined
export function resolveLevel(lv: LvValue): LevelDef | undefined {
  if (lv === null) return undefined
  if ('id' in lv) return LEVELS_BY_ID.get(lv.id)
  if (lv.json === inlineJsonCache) return inlineLevelCache
  try {
    const level = levelFromJson(JSON.parse(lv.json) as LevelJson)
    inlineJsonCache = lv.json
    inlineLevelCache = level
    return level
  } catch {
    return undefined
  }
}

// FNV-1a 32bit：文本 → u32。关卡内容 hash（progress 绑定）与装饰种子（云/粒子同关可复现）共用同一实现
function fnv1a(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// 内置关卡内容 hash 预计算：标题页每渲染每关 2 次、导航/结算再各 1 次——原文不可变，模块加载算一次复用
const BUILTIN_HASH_BY_ID = new Map<string, string>()
for (const l of LEVELS) {
  const text = LEVEL_SOURCES.get(l.id)
  if (text) BUILTIN_HASH_BY_ID.set(l.id, fnv1a(text).toString(36))
}

// 关卡内容 hash（base36）：内置 = 关卡文件原文（预计算）；内联 = URL 里的 JSON 文本本身。
// 玩家解法记录据此绑定（progress.ts）：关卡改版 hash 变旧解自然失效；内联 DIY 关卡同 id 不同内容互不串号
export function levelHash(lv: LvValue): string | undefined {
  if (lv === null) return undefined
  if ('id' in lv) return BUILTIN_HASH_BY_ID.get(lv.id)
  return lv.json ? fnv1a(lv.json).toString(36) : undefined
}

// 内置关卡 hash 集（progress 据此区分内联 DIY 条目做上限修剪；内置进度永不动）
export const BUILTIN_LEVEL_HASHES: ReadonlySet<string> = new Set(BUILTIN_HASH_BY_ID.values())

// 内置关卡 1 基序号（非内置/DIY = 0）：标题屏与状态条共用同源编号
export function levelNo(id: string): number {
  const i = LEVELS.findIndex((l) => l.id === id)
  return i < 0 ? 0 : i + 1
}

// 装饰种子：slug 哈希 + 盐（云与粒子以不同盐派生，同关可复现、互不串号）
export function levelSeed(id: string, salt = 0): number {
  return (fnv1a(id) ^ salt) >>> 0
}
