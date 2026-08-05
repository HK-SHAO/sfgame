import { name } from '../../package.json'

/** localStorage 键：name 前缀统一（存储管理页据此识别/摘要，勿改） */
export const MUTED_KEY = `${name}.muted`
const STORAGE_KEY = MUTED_KEY
const MASTER_GAIN = 0.5

/** Paul Kellet 粉红噪声近似：白噪声经一阶 IIR 组逼近 1/f 谱——正是自然风湍流的能量分布特征。 */
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
  /** 可选立体声定位（仅飞机摩擦声用：按横向位置左右移动） */
  private panner: StereoPannerNode | null = null
  private level = 0

  constructor(
    ctx: AudioContext,
    dest: AudioNode,
    noise: AudioBuffer,
    opts: WindVoiceOptions,
    stereo = false,
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
    if (stereo) {
      this.panner = ctx.createStereoPanner()
      this.gainNode.connect(this.panner)
      this.panner.connect(dest)
    } else {
      this.gainNode.connect(dest)
    }
    src.start()
  }

  setPan(value: number) {
    if (this.panner) this.panner.pan.value = value
  }

  update(speed: number, dt: number) {
    const t = Math.min(1, Math.max(0, speed) / this.opts.vFull)
    const target = t * t * this.opts.maxGain
    const k = 1 - Math.exp(-dt / this.opts.tau)
    this.level += (target - this.level) * k
    this.gainNode.gain.value = this.level
    this.filter.frequency.value = this.opts.baseFreq + this.opts.freqSpan * t
  }

  /** 淡出到静音并复位内部电平（离开游戏场景时调用，防风声残留） */
  silence() {
    this.level = 0
    this.gainNode.gain.setTargetAtTime(0, this.gainNode.context.currentTime, 0.25)
  }
}

/**
 * 零依赖音效：WebAudio 合成。
 * 两层声音：离散 UI 音（振荡器）+ 连续物理风声（噪声滤波，见 WindVoice）。
 */
class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private bed: WindVoice | null = null
  private planeWind: WindVoice | null = null
  private unlockArmed = false
  muted = false

  constructor() {
    try {
      this.muted = localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
    }
  }

  /**
   * 解锁音频（浏览器自动播放策略：AudioContext 须在用户手势内创建/恢复）。
   * 首次调用即挂全局一次性监听（pointerdown/keydown）——整个应用任意位置
   * 的第一次用户交互即完成解锁，此后音频恒可播放，不依赖具体交互路径。
   */
  unlock() {
    if (!this.unlockArmed) {
      this.unlockArmed = true
      const fire = () => this.unlock()
      document.addEventListener('pointerdown', fire, { once: true })
      document.addEventListener('keydown', fire, { once: true })
    }
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
        }, true)
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

  /** 离开游戏场景时淡出风声：防止标题页/解法页残留风声（游戏内 tick 会重新驱动） */
  fadeOutWind() {
    this.bed?.silence()
    this.planeWind?.silence()
  }

  /** 飞机摩擦声左右定位：按飞机横向位置（x∈[0,worldW]）在声道间移动 */
  setPlanePan(x: number, worldW: number) {
    this.planeWind?.setPan(Math.max(-1, Math.min(1, (x / worldW) * 2 - 1)))
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
   * 播完显式断开整条节点链：否则 WebKit 音频图持有已完成节点（长会话累积 → GC 压力与掉帧）；
   * 等 ended 后再断开，中途不静音。
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
    // 音高 ±5% 随机：连放不机械
    const f = 620 * (0.95 + Math.random() * 0.1)
    this.tone(f, f * 0.52, 0.14, 'sine', 0.5)
  }

  placeCold() {
    const f = 340 * (0.95 + Math.random() * 0.1)
    this.tone(f, f * 0.59, 0.16, 'sine', 0.5)
  }

  remove() {
    this.tone(260, 180, 0.07, 'triangle', 0.3)
  }

  deny() {
    this.tone(150, 120, 0.09, 'square', 0.1)
  }

  /**
   * UI 交互音效族：同一家族（短促软 sine/triangle、音量低于玩法反馈音），
   * 语义区分——前进上行、后退下行、重置双音、通用单音。
   */
  uiClick() {
    this.tone(620, 480, 0.06, 'sine', 0.22)
  }

  uiEnter() {
    this.tone(520, 860, 0.09, 'sine', 0.25)
  }

  uiBack() {
    this.tone(520, 320, 0.08, 'sine', 0.22)
  }

  uiReset() {
    this.tone(440, 440, 0.05, 'triangle', 0.25)
    this.tone(440, 440, 0.05, 'triangle', 0.25, 0.07)
  }

  win() {
    const notes = [523.25, 659.25, 783.99, 1046.5]
    notes.forEach((f, i) => this.tone(f, f, 0.22, 'triangle', 0.32, i * 0.09))
  }

  /**
   * 站点抵达的"奖励"提示音：轻快的双音上行（与过关的四音琶音明显区分，
   * 音量也更收敛——它是途中鼓励，不是结算）。
   */
  reward() {
    this.tone(880, 880, 0.09, 'sine', 0.28)
    this.tone(1174.66, 1174.66, 0.15, 'sine', 0.24, 0.07)
  }
}

export const sfx = new Sfx()
