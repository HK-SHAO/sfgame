import { LEVEL_1, LEVELS } from './levels'
import { levelFromJson, parseLevelText } from './level-format'
import type { LevelDef } from './types'

/** dev 面板 YAML 编辑生效事件名（window 级，dev-panel.ts 派发 / app.ts 消费）。 */
export const DEV_OVERRIDE_EVENT = 'sf-dev-override'
/** lv=0 开发槽：基础 YAML = 第 1 关；dev 面板编辑生效即跳到它，浏览器返回即复原 */
export const DEV_SLOT = 0

interface Override {
  level: LevelDef
  text: string
}

/** 会话级关卡覆写（#15 dev 面板）：仅本页面会话有效，刷新即失，绝不触碰关卡文件。 */
let override: Override | null = null

/** 解析并写入开发槽覆写（非法文本抛错）；返回解析后的关卡。 */
export function setDevOverride(text: string): LevelDef {
  const level = levelFromJson(parseLevelText(text))
  override = { level, text }
  return level
}

/** 编辑器预填：上次覆写文本 → 第 1 关原始 YAML。 */
export function getDevOverrideText(): string | undefined {
  return override?.text
}

/** 关卡解析：lv=0 取覆写（无则第 1 关）；其余回退内置关卡。 */
export function resolveLevel(id: number): LevelDef | undefined {
  if (id === DEV_SLOT) return override?.level ?? LEVEL_1
  return LEVELS.find((l) => l.id === id)
}
