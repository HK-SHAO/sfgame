import { LEVEL_1, LEVELS } from './levels'
import { levelFromJson, parseLevelText } from './level-format'
import type { LevelDef } from './types'

// dev 面板 YAML 编辑生效事件名（window 级，dev-panel.ts 派发 / app.ts 消费）
export const DEV_OVERRIDE_EVENT = 'sf-dev-override'
// lv=0 开发槽：基础 YAML = 第 1 关；dev 面板编辑生效即跳到它，浏览器返回即复原
export const DEV_SLOT = 0

interface Override {
  level: LevelDef
  text: string
}

let override: Override | null = null

export function setDevOverride(text: string): LevelDef {
  const level = levelFromJson(parseLevelText(text))
  override = { level, text }
  return level
}

export function getDevOverrideText(): string | undefined {
  return override?.text
}

export function resolveLevel(id: number): LevelDef | undefined {
  if (id === DEV_SLOT) return override?.level ?? LEVEL_1
  return LEVELS.find((l) => l.id === id)
}
