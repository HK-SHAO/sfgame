// 全局背景乐「风息」：流式 Audio 元素（整曲不解码进内存）。由 fb.unlock 统一在首次用户手势内
// 启动（HTMLAudioElement.play 同受自动播放策略约束，与 sfx 同节奏、幂等可重试）；
// 静音/页面隐藏时暂停省资源；资源级失败（404/损坏）标记 failed 后不再重试——音乐缺失不影响游戏；
// 播放速率跟随关卡倍率（变调无音高补偿，0.05 极低音量下瑕疵被掩蔽）；
// 关卡暂停同步停乐（controller 直驱 setPaused），恢复/重置/离关解除
import bgmUrl from '/bgm-main.mp3?url'

const BGM_VOLUME = 0.05
// HTMLMediaElement.playbackRate 支持范围；关卡倍率最高 16 恰好在界内
const RATE_MIN = 0.0625
const RATE_MAX = 16

class Bgm {
  private el: HTMLAudioElement | null = null
  private failed = false
  private paused = false
  private rate = 1
  muted = false

  // 幂等可重入（fb 手势驱动、每次手势可重试）：元素未建且未失败才创建；play 被拒（非手势上下文）
  // 由下一次手势重试，muted 挡在 attempt 前
  start() {
    if (!this.el && !this.failed) {
      let el: HTMLAudioElement
      try {
        el = new Audio(bgmUrl)
      } catch {
        this.failed = true
        return
      }
      el.loop = true
      el.preload = 'none'
      el.volume = this.muted ? 0 : BGM_VOLUME
      el.playbackRate = this.rate
      // 资源失败（404/解码损坏）:元素不可再用，清引用交 GC，failed 挡后续重建
      el.addEventListener('error', () => {
        this.failed = true
        this.el = null
      })
      this.el = el
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.el?.pause()
        else this.attempt()
      })
    }
    this.attempt()
  }

  // play() 拒绝静默：NotAllowedError（非手势上下文）待下次手势/切回前台自然重试
  private attempt() {
    if (!this.el || this.failed || this.muted || this.paused) return
    void this.el.play().catch(() => {})
  }

  // paused 挡在 attempt 前：暂停期间切回前台/解除静音都不会误恢复
  setPaused(p: boolean) {
    if (this.paused === p) return
    this.paused = p
    if (!this.el) return
    if (p) this.el.pause()
    else this.attempt()
  }

  setMuted(m: boolean) {
    this.muted = m
    if (!this.el) return
    if (m) this.el.pause()
    else this.attempt()
  }

  setRate(rate: number) {
    this.rate = Math.min(RATE_MAX, Math.max(RATE_MIN, rate))
    if (this.el) this.el.playbackRate = this.rate
  }
}

export const bgm = new Bgm()
