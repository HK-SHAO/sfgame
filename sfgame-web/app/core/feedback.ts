import { sfx } from './sfx'
import { haptics } from './haptics'
import { bgm } from './bgm'

// 语义反馈门面：一个操作事件 = 音效 + 震动的固定配对，全app唯一配对点（一致性）；
// 音频图（sfx）与震动（haptics）各自独立实现（解耦）。离散反馈一律走 fb；
// 连续声层（风声）由 controller 直驱 sfx，全局背景乐由 fb 解锁/静音协调
haptics.muted = sfx.muted
bgm.muted = sfx.muted

export const fb = {
  unlock() {
    sfx.unlock()
    bgm.start()
  },

  get muted() {
    return sfx.muted
  },

  toggleMuted(): boolean {
    const m = sfx.toggleMuted()
    haptics.muted = m
    bgm.setMuted(m)
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
