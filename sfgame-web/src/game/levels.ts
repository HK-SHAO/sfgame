import { levelFromJson, parseLevelText } from './level-format'
import type { LevelDef } from './types'
// YAML 经 ?raw 直读（vite 原生支持、随文件变更触发 HMR），解析在运行时统一走 parseLevelText——无需虚拟模块/构建插件
import level1 from '../../levels/level-1.yaml?raw'
import level2 from '../../levels/level-2.yaml?raw'
import level3 from '../../levels/level-3.yaml?raw'
import level4 from '../../levels/level-4.yaml?raw'
import level5 from '../../levels/level-5.yaml?raw'

/** 新关卡 = 新增一个 YAML 文件并登记 import，模拟/渲染/URL/解法参考页自动生效。 */
const LEVEL_TEXTS = [level1, level2, level3, level4, level5]

/**
 * 逐关容错加载：坏关卡（DIY 编辑出错等）只进 LEVEL_ERRORS 清单，
 * 绝不在此抛错——模块加载抛错会让整个 bundle 求值失败 → 应用白屏。
 * UI 层把清单渲染成可见告警（见 app.ts 标题页）。
 */
export const LEVELS: LevelDef[] = []
export const LEVEL_ERRORS: string[] = []
/** 原始关卡文本（id → YAML）：dev 面板编辑器预填用；坏关卡无条目 */
export const LEVEL_SOURCES = new Map<number, string>()
export function levelSource(id: number): string | undefined {
  return LEVEL_SOURCES.get(id)
}
for (const text of LEVEL_TEXTS) {
  try {
    const level = levelFromJson(parseLevelText(text))
    LEVELS.push(level)
    LEVEL_SOURCES.set(level.id, text)
  } catch (e) {
    LEVEL_ERRORS.push(e instanceof Error ? e.message : String(e))
  }
}

/** 命名导出兼容（老测试/基准脚本按名字引用前两关）。 */
export const LEVEL_1 = LEVELS[0]
export const LEVEL_2 = LEVELS[1]
