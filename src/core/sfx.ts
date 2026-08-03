const STORAGE_KEY = 'zaofeng.muted'
const MASTER_GAIN = 0.5

/**
 * Paul Kellet 粉红噪声近似滤波：白噪声经一阶 IIR 组逼近 1/f 功率谱。
 * 1/f 谱正是自然风湍流的能量分布特征，比白噪声听感真实得多。
 */
function makePinkNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const len = ctx.sampleRate * 2
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  let b0 = 0
  let b1 = 0
  let b2 = 0
  let b3 = 0
  let b4 = 0
  let b5 = 0
  let b6 = 0
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1
    b0 = 0.99886 * b0 + white * 0.0555179
    b1 = 0.99332 * b1 + white * 0.0750759
    b2 = 0.969 * b2 + white * 0.153852
    b3 = 0.8665 * b3 + white * 0.3104856
    b4 = 0.55 * b4 + white * 0.5329522
    b5 = -0.7616 * b5 - white * 0.016898
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11
    b6 = white * 0.115926
  }
  return buffer
}

export interface WindVoiceOptions {
  /** 零风速时的带通中心频率 */
  baseFreq: number
  /** 风速升到 vFull 时增加的频率跨度（风越大声越"亮"） */
  freqSpan: number
  /** 响度达到峰值对应的风速 */
  vFull: number
  maxGain: number
  /** 响度平滑时间常数（秒），避免抖动 */
  tau: number
}

/**
 * 持续的"风声"：粉红噪声 → 带通滤波 → 增益。
 * 物理驱动：响度 ∝ (v/vFull)²（气动噪声随流速非线性增长的近似），
 * 带通中心频率随风速上移（快风含更多高频湍流成分）。
 */
class WindVoice {
  private opts: WindVoiceOptions
  private gainNode: GainNode
  private filter: BiquadFilterNode
  private level = 0

  constructor(
    ctx: AudioContext,
    dest: AudioNode,
    noise: AudioBuffer,
    opts: WindVoiceOptions,
  ) {
    this.opts = opts
    const src = ctx.createBufferSource()
    src.buffer = noise
    src.loop = true
    this.filter = ctx.createBiquadFilter()
    this.filter.type = 'bandpass'
    this.filter.frequency.value = opts.baseFreq
    this.filter.Q.value = 0.85
    this.gainNode = ctx.createGain()
    this.gainNode.gain.value = 0
    src.connect(this.filter)
    this.filter.connect(this.gainNode)
    this.gainNode.connect(dest)
    src.start()
  }

  update(speed: number, dt: number) {
    const t = Math.min(1, Math.max(0, speed) / this.opts.vFull)
    const target = t * t * this.opts.maxGain
    const k = 1 - Math.exp(-dt / this.opts.tau)
    this.level += (target - this.level) * k
    this.gainNode.gain.value = this.level
    this.filter.frequency.value = this.opts.baseFreq + this.opts.freqSpan * t
  }
}

/**
 * 零依赖音效：WebAudio 合成。iOS 要求 AudioContext 必须在用户手势中
 * 创建/恢复，因此 unlock() 由任意 pointerdown 触发。
 *
 * 两层声音：离散 UI 音（振荡器）+ 连续物理风声（噪声滤波，见 WindVoice）。
 */
class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private bed: WindVoice | null = null
  private planeWind: WindVoice | null = null
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
        this.master.gain.value = this.muted ? 0 : MASTER_GAIN
        this.master.connect(this.ctx.destination)
        this.noiseBuf = makePinkNoiseBuffer(this.ctx)
        this.bed = new WindVoice(this.ctx, this.master, this.noiseBuf, {
          baseFreq: 180,
          freqSpan: 420,
          vFull: 9,
          maxGain: 0.16,
          tau: 0.6,
        })
        this.planeWind = new WindVoice(this.ctx, this.master, this.noiseBuf, {
          baseFreq: 420,
          freqSpan: 900,
          vFull: 8,
          maxGain: 0.3,
          tau: 0.18,
        })
        // 页面隐藏时挂起音频，避免后台持续出声；恢复可见时立即恢复（不依赖下次触摸）
        document.addEventListener('visibilitychange', () => {
          if (!this.ctx) return
          if (document.hidden) void this.ctx.suspend()
          else if (this.ctx.state === 'suspended') void this.ctx.resume()
        })
      } catch {
        this.ctx = null
        this.master = null
        return
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  /**
   * 每模拟步驱动物理风声。
   * @param fieldWind 全场代表风速（风越大，底噪越响）
   * @param planeRel 飞机相对空气的速度——摩擦声的真实来源：
   *   随风飘（相对速度≈0）时安静，逆风/坠落切割空气时呼啸
   */
  updateWind(fieldWind: number, planeRel: number, dt: number) {
    if (!this.ctx || !this.bed || !this.planeWind) return
    this.bed.update(fieldWind, dt)
    this.planeWind.update(planeRel, dt)
  }

  /** 落地/擦地撞击声：响度与低通截止随撞击速度增大（动能 → 声能） */
  land(impact: number) {
    if (this.muted || !this.ctx || !this.master || !this.noiseBuf) return
    if (impact < 0.6) return
    try {
      const t0 = this.ctx.currentTime
      const src = this.ctx.createBufferSource()
      src.buffer = this.noiseBuf
      src.playbackRate.value = 0.7 + Math.random() * 0.4
      const lp = this.ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 260 + 320 * Math.min(1, impact / 6)
      const g = this.ctx.createGain()
      const peak = Math.min(0.5, 0.06 + impact * 0.045)
      g.gain.setValueAtTime(peak, t0)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.17)
      src.connect(lp)
      lp.connect(g)
      g.connect(this.master)
      src.start(t0, Math.random() * 1.4, 0.22)
      this.releaseWhenDone(src, [src, lp, g])
    } catch {
    }
  }

  toggleMuted(): boolean {
    this.muted = !this.muted
    try {
      localStorage.setItem(STORAGE_KEY, this.muted ? '1' : '0')
    } catch {
    }
    if (this.master && this.ctx) {
      // 连续风声层由主增益统一静音
      this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER_GAIN, this.ctx.currentTime, 0.05)
    }
    return this.muted
  }

  /**
   * 一次性音源播完后显式断开整条节点链：不这么做的话 WebKit 的音频图
   * 会持有已完成节点（长会话累积 → GC 压力与掉帧）。ended 事件确保
   * 播放结束（或 stop 到达）后才断开，中途不静音。
   */
  private releaseWhenDone(
    src: AudioScheduledSourceNode,
    nodes: Array<AudioNode | AudioScheduledSourceNode>,
  ) {
    const cleanup = () => {
      for (const n of nodes) {
        try {
          n.disconnect()
        } catch {
        }
      }
    }
    try {
      src.addEventListener('ended', cleanup, { once: true })
    } catch {
      // 极端环境（无 ended 事件）下退化为延迟清理
      window.setTimeout(cleanup, 2000)
    }
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
      this.releaseWhenDone(osc, [osc, gain])
    } catch {
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
