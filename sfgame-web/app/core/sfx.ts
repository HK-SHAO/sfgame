import { name } from '../../package.json'

const STORAGE_KEY = `${name}.muted`
const MASTER_GAIN = 0.5

// Paul Kellet 粉红噪声近似：白噪声经一阶 IIR 组逼近 1/f 谱——自然风湍流的能量分布
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
  baseFreq: number
  freqSpan: number
  vFull: number
  maxGain: number
  tau: number
}

// 风声物理映射：响度 ∝ (v/vFull)²（气动噪声近似），带通中心频率随风速上移
class WindVoice {
  private opts: WindVoiceOptions
  private gainNode: GainNode
  private filter: BiquadFilterNode
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

  silence() {
    this.level = 0
    this.gainNode.gain.setTargetAtTime(0, this.gainNode.context.currentTime, 0.25)
  }
}

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

  // 浏览器自动播放策略：AudioContext 须在用户手势内创建/恢复。
  // 首次调用（非手势，如 app 构造）仅布防监听并返回；ctx 创建留给手势 fire，杜绝非手势创建+resume 被 Chrome 拒绝
  unlock() {
    if (!this.unlockArmed) {
      this.unlockArmed = true
      const fire = () => this.unlock()
      document.addEventListener('pointerdown', fire, { once: true })
      document.addEventListener('keydown', fire, { once: true })
      return
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

  // planeRel 是飞机相对空气的速度：随风飘安静，逆风/坠落切割空气才呼啸
  updateWind(fieldWind: number, planeRel: number, dt: number) {
    if (!this.ctx || !this.bed || !this.planeWind) return
    this.bed.update(fieldWind, dt)
    this.planeWind.update(planeRel, dt)
  }

  fadeOutWind() {
    this.bed?.silence()
    this.planeWind?.silence()
  }

  setPlanePan(x: number, worldW: number) {
    this.planeWind?.setPan(Math.max(-1, Math.min(1, (x / worldW) * 2 - 1)))
  }

  // 落地音：响度与低通截止随撞击速度增大（动能 → 声能）
  land(impact: number) {
    if (this.muted || !this.ctx || !this.master || !this.noiseBuf) return
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
      this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER_GAIN, this.ctx.currentTime, 0.05)
    }
    return this.muted
  }

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
      window.setTimeout(cleanup, 2000)
    }
  }

  // FM 合成：载波 sine + ratio 倍频调制，泛音随包络衰减——钢片琴/冰晶/电钢的明亮个性
  private fmTone(f: number, dur: number, peak: number, ratio: number, index: number, delay = 0) {
    if (this.muted || !this.ctx || !this.master) return
    try {
      const t0 = this.ctx.currentTime + delay
      const car = this.ctx.createOscillator()
      car.type = 'sine'
      car.frequency.value = f
      const mod = this.ctx.createOscillator()
      mod.type = 'sine'
      mod.frequency.value = f * ratio
      const mg = this.ctx.createGain()
      mg.gain.setValueAtTime(f * index, t0)
      mg.gain.exponentialRampToValueAtTime(Math.max(1, f * 0.05), t0 + dur * 0.7)
      mod.connect(mg)
      mg.connect(car.frequency)
      const g = this.ctx.createGain()
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
      car.connect(g)
      g.connect(this.master)
      car.start(t0)
      mod.start(t0)
      car.stop(t0 + dur + 0.05)
      mod.stop(t0 + dur + 0.05)
      this.releaseWhenDone(car, [car, mod, mg, g])
    } catch {
    }
  }

  // 噪声脉冲：低通截爆点（火焰“蓬”、风压等物理感）
  private noiseBurst(cutoff: number, dur: number, peak: number, delay = 0) {
    if (this.muted || !this.ctx || !this.master || !this.noiseBuf) return
    try {
      const t0 = this.ctx.currentTime + delay
      const src = this.ctx.createBufferSource()
      src.buffer = this.noiseBuf
      src.playbackRate.value = 0.9 + Math.random() * 0.2
      const lp = this.ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = cutoff
      const g = this.ctx.createGain()
      g.gain.setValueAtTime(peak, t0)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
      src.connect(lp)
      lp.connect(g)
      g.connect(this.master)
      src.start(t0, Math.random() * 1.4, dur + 0.05)
      this.releaseWhenDone(src, [src, lp, g])
    } catch {
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

  grab() {
    this.tone(880, 660, 0.045, 'sine', 0.1)
  }

  pause(paused: boolean) {
    if (paused) this.tone(392, 294, 0.08, 'sine', 0.2)
    else this.tone(294, 392, 0.08, 'sine', 0.2)
  }

  // 火焰“蓬”：下滑音 + 低通噪声爆点（点燃的物理感）
  placeHot() {
    const f = 620 * (0.95 + Math.random() * 0.1)
    this.tone(f, f * 0.52, 0.14, 'sine', 0.4)
    this.noiseBurst(520, 0.1, 0.15)
  }

  // 冰晶“叮铃”：FM 高载波双音（G6 + D7），3.07 非谐波比出金属泛音
  placeCold() {
    this.fmTone(1567.98, 0.24, 0.28, 3.07, 3.5)
    this.fmTone(2349.32, 0.18, 0.13, 3.07, 3, 0.05)
  }

  remove() {
    this.tone(260, 180, 0.07, 'triangle', 0.3)
  }

  deny() {
    this.tone(150, 120, 0.09, 'square', 0.1)
  }

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

  // 过关：FM 电钢终止式（C 大调琶音 + 主音长音 + C3 低音锚点）
  win() {
    const notes = [523.25, 659.25, 783.99, 1046.5]
    notes.forEach((f, i) => this.fmTone(f, 0.5, 0.26, 2.99, 2.6, i * 0.11))
    this.fmTone(1046.5, 1.0, 0.24, 2.99, 2.2, 0.46)
    this.tone(130.81, 130.81, 0.9, 'sine', 0.16, 0.46)
  }

  // 抵达奖励：chiptune 快琶音（8bit 琶音器技法，A5-D6-E6-A6 四音 50ms 连发）
  reward() {
    const notes = [880, 1174.66, 1318.51, 1760]
    notes.forEach((f, i) => this.fmTone(f, 0.13, 0.2, 2, 2.2, i * 0.05))
  }
}

export const sfx = new Sfx()
