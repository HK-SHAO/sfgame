import { resolveLevel } from './session'
import type { AppView } from './state'
import { urlState } from './state'
import type { LevelDef, SourcePlacement } from './types'

export type Screen = 'title' | 'game' | 'solutions' | 'dev' | 'storage'

export interface ScreenState {
  screen: Screen
  level: LevelDef | undefined
  sources: SourcePlacement[]
}

// URL → 界面唯一派生点：v 优先于 lv（页面键与关卡共存时以页面为准，solutionUrl 分享链接已清 v）
export function deriveScreen(v: AppView, lv: number | null, sources: SourcePlacement[]): ScreenState {
  if (v !== 'title') return { screen: v, level: undefined, sources }
  const level = lv === null ? undefined : resolveLevel(lv)
  if (!level) return { screen: 'title', level: undefined, sources }
  return { screen: 'game', level, sources }
}

export function screenFromUrl(): ScreenState {
  return deriveScreen(urlState.get('v'), urlState.get('lv'), urlState.get('src'))
}
