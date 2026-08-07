import { LEVELS } from './levels'
import { levelFromJson } from './level-format'
import type { LevelDef, LevelJson } from './types'

// dev 面板 YAML 编辑生效事件名（window 级，level-editor.ts 派发 / app.ts 消费）
export const DEV_OVERRIDE_EVENT = 'sf-dev-override'

// lv 双形态解析：数字 = 内置关卡；字符串 = URL 内联关卡 JSON（state.ts 编解码，解析失败视为无效）
export function resolveLevel(lv: number | string | null): LevelDef | undefined {
  if (typeof lv === 'number') return LEVELS.find((l) => l.id === lv)
  if (typeof lv === 'string') {
    try {
      return levelFromJson(JSON.parse(lv) as LevelJson)
    } catch {
      return undefined
    }
  }
  return undefined
}
