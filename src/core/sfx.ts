const STORAGE_KEY = 'zaofeng.muted'

/**
 * 零依赖音效：WebAudio 振荡器合成。iOS 要求 AudioContext 必须在用户手势中
 * 创建/恢复，因此 unlock() 由任意 pointerdown 触发。
 */
class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  muted = false

  constructor() {
    try {
      this.muted = localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      /* 无 localStorage 环境时保持默认开启 */
    }
  }

  unlock() {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      if (!Ctor) return
      try {
        this.ctx = new Ctor()
        this.master = this.ctx.createGain()
        this.master.gain.value = 0.5
        this.master.connect(this.ctx.destination)
      } catch {
        this.ctx = null
        this.master = null
        return
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  toggleMuted(): boolean {
    this.muted = !this.muted
    try {
      localStorage.setItem(STORAGE_KEY, this.muted ? '1' : '0')
    } catch {
      /* 忽略持久化失败 */
    }
    return this.muted
  }

  private tone(
    f0: number,
    f1: number,
    dur: number,
    type: OscillatorType,
    peak: number,
    delay = 0,
  ) {
    if (this.muted || !this.ctx || !this.master) return
    try {
      const t0 = this.ctx.currentTime + delay
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = type
      osc.frequency.setValueAtTime(Math.max(1, f0), t0)
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur)
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
      osc.connect(gain)
      gain.connect(this.master)
      osc.start(t0)
      osc.stop(t0 + dur + 0.05)
    } catch {
      /* 音频失败不影响游戏 */
    }
  }

  placeHot() {
    this.tone(620, 320, 0.14, 'sine', 0.5)
  }

  placeCold() {
    this.tone(340, 200, 0.16, 'sine', 0.5)
  }

  remove() {
    this.tone(260, 180, 0.07, 'triangle', 0.3)
  }

  deny() {
    this.tone(150, 120, 0.09, 'square', 0.1)
  }

  win() {
    const notes = [523.25, 659.25, 783.99, 1046.5]
    notes.forEach((f, i) => this.tone(f, f, 0.22, 'triangle', 0.32, i * 0.09))
  }
}

export const sfx = new Sfx()
