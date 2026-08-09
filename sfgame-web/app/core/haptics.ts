// 震动反馈（Vibration API，仅 Android 可用；iOS 不支持 → 特性检测 no-op）；UI 导航不震（高频震动即噪音）
class Haptics {
  muted = false

  private fire(pattern: number | number[]) {
    if (this.muted) return
    if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return
    try {
      navigator.vibrate(pattern)
    } catch {
    }
  }

  tap() {
    this.fire(12)
  }

  grab() {
    this.fire(8)
  }

  deny() {
    this.fire([24, 48, 24])
  }

  land(impact: number) {
    this.fire(Math.min(36, Math.round(6 + impact * 4)))
  }

  reward() {
    this.fire([18, 46, 18])
  }

  win() {
    this.fire([26, 55, 26, 55, 80])
  }
}

export const haptics = new Haptics()
