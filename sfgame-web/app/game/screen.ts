import { resolveLevel } from './session'
import type { AppView, LvValue } from './state'
import { urlState } from './state'
import type { LevelDef, SourcePlacement } from './types'

export type Screen = 'title' | 'game' | 'dev' | 'storage'

export interface ScreenState {
  screen: Screen
  level: LevelDef | undefined
  sources: SourcePlacement[]
}

// URL → 界面唯一派生点：v 优先于 lv（页面键与关卡共存时以页面为准，solutionUrl 分享链接已清 v）
export function deriveScreen(v: AppView, lv: LvValue, sources: SourcePlacement[]): ScreenState {
  if (v !== 'title') return { screen: v, level: undefined, sources }
  const level = lv === null ? undefined : resolveLevel(lv)
  if (!level) return { screen: 'title', level: undefined, sources }
  return { screen: 'game', level, sources }
}

export function screenFromUrl(): ScreenState {
  const s = deriveScreen(urlState.get('v'), urlState.get('lv'), urlState.get('src'))
  // 非法 lv 净化：参数存在但解析失败（越界 id/损坏内联）→ replace 移除，不留脏参数。
  // v≠title 时 screen 非 title 不会误删；clear 写读分离不回调，replace 不产生历史（C7）
  if (s.screen === 'title' && urlState.has('lv')) urlState.clear('lv', { replace: true })
  return s
}
