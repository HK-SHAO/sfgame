import { resolveLevel } from './levels'
import type { AppView, LvValue } from './state'
import { urlState } from './state'
import type { LevelDef, SourcePlacement } from './types'

export type Screen = 'title' | 'game' | AppView

export interface ScreenState {
  screen: Screen
  level: LevelDef | undefined
  sources: SourcePlacement[]
}

// URL → 界面唯一派生点：v 优先于 lv（页面键与关卡共存时以页面为准）
export function deriveScreen(v: AppView, lv: LvValue, sources: SourcePlacement[]): ScreenState {
  if (v !== 'title') return { screen: v, level: undefined, sources }
  const level = lv === null ? undefined : resolveLevel(lv)
  if (!level) return { screen: 'title', level: undefined, sources }
  return { screen: 'game', level, sources }
}

// cleanup 仅外部 URL 变化路径开启（初始加载/popstate）：此时 values 已与 URL 同步，has() 的判定才是准确的。
// 本地写路径（flush 是微任务、URL 还没变）若开启会把 backToTitle 的 push 批翻转成 replace（批模式由最后一次调用决定）
export function screenFromUrl(cleanup = false): ScreenState {
  const s = deriveScreen(urlState.get('v'), urlState.get('lv'), urlState.get('src'))
  if (cleanup && s.screen === 'title' && urlState.has('lv')) {
    // 非法 lv 净化：参数存在但解析失败（越界 id/损坏内联）→ replace 移除，不留脏参数
    urlState.clear('lv', { replace: true })
  }
  return s
}
