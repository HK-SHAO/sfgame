// 全局背景乐「风息」：流式 Audio 元素（整曲不解码进内存），首次用户手势后启动，
// 静音/页面隐藏时暂停省资源；资源级失败（404/损坏）标记 failed 后不再重试——音乐缺失不影响游戏；
// 播放速率跟随关卡倍率（变调无音高补偿，0.05 极低音量下瑕疵被掩蔽）
const BGM_VOLUME = 0.05
const BGM_SRC = '/bgm-main.mp3'
// HTMLMediaElement.playbackRate 支持范围；关卡倍率最高 16 恰好在界内
const RATE_MIN = 0.0625
const RATE_MAX = 16

class Bgm {
  private el: HTMLAudioElement | null = null
  private failed = false
  private rate = 1
  muted = false

  // 须在用户手势内首次调用（浏览器自动播放策略），后续幂等
  start() {
    if (!this.el && !this.failed) {
      let el: HTMLAudioElement
      try {
        el = new Audio(BGM_SRC)
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
    if (!this.el || this.failed || this.muted) return
    void this.el.play().catch(() => {})
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
