import { sfx } from './sfx.ts'
import { haptics } from './haptics.ts'
import { bgm } from './bgm.ts'

// 语义反馈门面：一个操作事件 = 音效 + 震动的固定配对，全app唯一配对点（一致性）；
// 离散反馈一律走 fb；连续声层（风声）由 controller 直驱 sfx，背景乐由 fb 解锁/静音协调（暂停由 controller 直驱 bgm）
haptics.muted = sfx.muted
bgm.muted = sfx.muted

// 音频权限统一解锁：自动播放策略要求手势内创建/恢复（AudioContext resume 与 Audio play 同受约束）。
// 非手势调用仅布防监听；每次手势幂等尝试（不 once，首次被拒后续手势自动重试）
let unlockArmed = false
const unlockAudio = () => {
  sfx.unlock()
  bgm.start()
}

export const fb = {
  unlock() {
    if (unlockArmed) return
    unlockArmed = true
    document.addEventListener('pointerdown', unlockAudio)
    document.addEventListener('keydown', unlockAudio)
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
