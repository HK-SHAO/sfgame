import { sfx } from './sfx'
import { haptics } from './haptics'

// 语义反馈门面：一个操作事件 = 音效 + 震动的固定配对，全app唯一配对点（一致性）；
// 音频图（sfx）与震动（haptics）各自独立实现（解耦）。离散反馈一律走 fb；
// 连续声层（风声）与背景音乐传输是音频引擎内部状态，由 controller 直驱 sfx
haptics.muted = sfx.muted

export const fb = {
  unlock() {
    sfx.unlock()
  },

  get muted() {
    return sfx.muted
  },

  toggleMuted(): boolean {
    const m = sfx.toggleMuted()
    haptics.muted = m
    return m
  },

  uiClick() {
    sfx.uiClick()
  },

  uiEnter() {
    sfx.uiEnter()
  },

  uiBack() {
    sfx.uiBack()
  },

  uiReset() {
    sfx.uiReset()
  },

  grab() {
    sfx.grab()
    haptics.grab()
  },

  placeHot() {
    sfx.placeHot()
    haptics.tap()
  },

  placeCold() {
    sfx.placeCold()
    haptics.tap()
  },

  remove() {
    sfx.remove()
    haptics.tap()
  },

  deny() {
    sfx.deny()
    haptics.deny()
  },

  land(impact: number) {
    if (impact < 0.6) return
    sfx.land(impact)
    haptics.land(impact)
  },

  reward() {
    sfx.reward()
    haptics.reward()
  },

  win() {
    sfx.win()
    haptics.win()
  },

  pause(paused: boolean) {
    sfx.pause(paused)
    haptics.grab()
  },
}
