// 程序化背景音乐：烘焙可序列化乐谱（纯函数，可无头测试）+ lookahead 调度播放
// 编曲思想学自 AlphaChord：万能走向 1645 驱动伴奏、根本旋律限定五声、奇偶小节疏密交错、
// 主旋律音量大于伴奏。根本旋律为人工作曲（动机重复 = 记忆点），关卡种子只做移调/走向/节奏型微调
// 自适应：setFlow(飞机相对风速) 实时驱动旋律层增益与亮度——风快音乐亮、停滞只剩伴奏

export interface ScoreNote {
  beat: number
  midi: number
  beats: number
  vel: number
}

export interface BgmScore {
  bpm: number
  root: number
  bars: number
  bass: ScoreNote[]
  arp: ScoreNote[]
  theme: ScoreNote[]
}

// 试听调参口：默认值即 app 内实际生效结构；render-score 脚本用变体参数出对比版
export interface BakeOpts {
  arpRest?: number
  themeShift?: number
}

const PENTA = [0, 2, 4, 7, 9]
const ROOTS = [57, 60, 62, 65]
// 自然大调和弦库（[根音半音, 是否大三]）：1645 / 1625 / 6451，流行配方的阳光底色
const PROGS = [
  [[0, 1], [9, 0], [5, 1], [7, 1]],
  [[0, 1], [9, 0], [2, 0], [7, 1]],
  [[9, 0], [5, 1], [7, 1], [0, 1]],
] as const
// 琶音节奏型库（8 个八分位置 mask，奇偶小节疏密交错）
const ARP_MASKS = [
  [[1, 1, 1, 0, 1, 1, 1, 0], [1, 0, 1, 1, 0, 1, 1, 1]],
  [[1, 1, 0, 1, 1, 1, 0, 1], [1, 1, 1, 0, 1, 0, 1, 1]],
  [[1, 1, 1, 1, 0, 1, 1, 0], [1, 0, 1, 1, 1, 0, 1, 1]],
]
const ARP_ARCH = [0, 1, 2, 3, 2, 1, 2, 1]

// 根本旋律（人工作曲，8 小节 2+2+4：风拂动机 → 模进 → 展开冲顶 → 台阶回落收束）
// [beat, 五声级数(相对 root), beats, vel]
const THEME: Array<readonly [number, number, number, number]> = [
  [0, 9, 1, 0.8], [1, 7, 0.5, 0.6], [1.5, 8, 0.5, 0.65], [2, 9, 1.5, 0.8], [3.5, 8, 0.5, 0.6],
  [4, 9, 0.5, 0.7], [4.5, 10, 0.5, 0.75], [5, 8, 1, 0.7], [6, 7, 1, 0.65], [7, 6, 1, 0.6],
  [8, 10, 1, 0.8], [9, 8, 0.5, 0.6], [9.5, 9, 0.5, 0.65], [10, 10, 1.5, 0.8], [11.5, 9, 0.5, 0.6],
  [12, 10, 0.5, 0.7], [12.5, 11, 0.5, 0.8], [13, 9, 1, 0.7], [14, 8, 1.5, 0.65], [15.5, 7, 0.5, 0.55],
  [16, 7, 1, 0.7], [17, 6, 0.5, 0.55], [17.5, 7, 0.5, 0.6], [18, 8, 2, 0.75],
  [20, 8, 0.5, 0.6], [20.5, 9, 0.5, 0.65], [21, 10, 1, 0.8], [22, 11, 1.5, 0.9],
  [24, 11, 0.5, 0.75], [24.5, 10, 0.5, 0.65], [25, 9, 0.5, 0.6], [25.5, 8, 0.5, 0.55], [26, 7, 2, 0.7],
  [28, 6, 2, 0.75], [30.5, 7, 0.5, 0.55], [31, 6, 1, 0.6],
]

// 确定性 PRNG：同种子同乐谱（烘焙可复现）；不同关卡种子产生微调差异
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function bakeScore(seed: number, opts: BakeOpts = {}): BgmScore {
  const { arpRest = 0.1, themeShift = 0 } = opts
  // 相邻小种子的 mulberry32 流头部强相关（各关卡 root 会撞车），先打散
  const rand = mulberry32(Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0)
  const root = ROOTS[Math.floor(rand() * ROOTS.length)]
  const bpm = 78 + Math.floor(rand() * 8)
  const bars = 8
  const prog = PROGS[Math.floor(rand() * PROGS.length)]
  const masks = ARP_MASKS[Math.floor(rand() * ARP_MASKS.length)]
  // 级数 → midi：跨八度也恒落音阶内（deg 可超 5）
  const at = (deg: number) => root + PENTA[((deg % 5) + 5) % 5] + 12 * Math.floor(deg / 5)

  const bass: ScoreNote[] = []
  const arp: ScoreNote[] = []
  for (let bar = 0; bar < bars; bar++) {
    const [semi, maj] = prog[bar % prog.length]
    bass.push({ beat: bar * 4, midi: root + semi - 12, beats: 1, vel: 0.5 })
    if (rand() < 0.45) bass.push({ beat: bar * 4 + 2, midi: root + semi - 5, beats: 0.5, vel: 0.38 })
    // 三和弦拱形分解（高一个八度，轻盈）：根 → 三 → 五 → 八 → 回
    const tones = [semi, semi + (maj ? 4 : 3), semi + 7, semi + 12]
    const mask = masks[bar % 2]
    for (let k = 0; k < 8; k++) {
      if (!mask[k] || (k > 0 && rand() < arpRest)) continue
      arp.push({ beat: bar * 4 + k * 0.5, midi: root + 12 + tones[ARP_ARCH[k]], beats: 0.5, vel: 0.32 + rand() * 0.18 })
    }
  }

  const theme = THEME.map(([beat, deg, beats, vel]) => ({
    beat,
    midi: at(deg + themeShift),
    beats,
    vel,
  }))
  return { bpm, root, bars, bass, arp, theme }
}

const midiFreq = (m: number) => 440 * 2 ** ((m - 69) / 12)

const LOOKAHEAD_MS = 90
const SCHED_AHEAD = 0.35
const BUS_GAIN = 0.22
const DUCK_GAIN = 0.1
const START_DELAY_MS = 700

export class MusicPlayer {
  private ctx: AudioContext
  private bus: GainNode
  private melBus: GainNode
  private melLp: BiquadFilterNode
  private delaySend: GainNode
  private timer: number | null = null
  private score: BgmScore | null = null
  private secPerStep = 0.5
  private startAt = 0
  private nextStep = 0
  private ducked = false
  // start/stop 竞态护栏：迟到的启动定时器不得复活已停的乐谱
  private gen = 0

  constructor(ctx: AudioContext, dest: AudioNode) {
    this.ctx = ctx
    this.bus = ctx.createGain()
    this.bus.gain.value = 0
    this.bus.connect(dest)
    // 主旋律层独立母线：flow 实时调增益与亮度（垂直分层混音）
    this.melBus = ctx.createGain()
    this.melBus.gain.value = 0.6
    this.melLp = ctx.createBiquadFilter()
    this.melLp.type = 'lowpass'
    this.melLp.frequency.value = 2000
    this.melBus.connect(this.melLp)
    this.melLp.connect(this.bus)
    // 共享反馈延迟链（一次创建）：附点节奏感回声，非山洞混响；不用 convolver（内存）
    this.delaySend = ctx.createGain()
    this.delaySend.gain.value = 0.45
    const delay = ctx.createDelay(1)
    delay.delayTime.value = 0.26
    const fbLp = ctx.createBiquadFilter()
    fbLp.type = 'lowpass'
    fbLp.frequency.value = 1800
    const fbGain = ctx.createGain()
    fbGain.gain.value = 0.22
    const wet = ctx.createGain()
    wet.gain.value = 0.15
    this.delaySend.connect(delay)
    delay.connect(fbLp)
    fbLp.connect(fbGain)
    fbGain.connect(delay)
    delay.connect(wet)
    wet.connect(this.bus)
  }

  start(score: BgmScore) {
    const gen = ++this.gen
    this.stopTimer()
    this.bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3)
    this.score = score
    this.secPerStep = 30 / score.bpm
    // 换关留一小段静默：旧音符尾音落定、新乐谱淡入
    window.setTimeout(() => {
      if (gen !== this.gen || this.score !== score) return
      this.startAt = this.ctx.currentTime + 0.1
      this.nextStep = 0
      this.melBus.gain.setTargetAtTime(0.6, this.ctx.currentTime, 0.1)
      this.melLp.frequency.setTargetAtTime(2000, this.ctx.currentTime, 0.1)
      this.bus.gain.setTargetAtTime(this.ducked ? DUCK_GAIN : BUS_GAIN, this.ctx.currentTime, 1.4)
      this.timer = window.setInterval(this.pump, LOOKAHEAD_MS)
      this.pump()
    }, START_DELAY_MS)
  }

  stop() {
    this.gen++
    this.score = null
    this.stopTimer()
    this.bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4)
  }

  duck(on: boolean) {
    this.ducked = on
    if (this.score) {
      this.bus.gain.setTargetAtTime(on ? DUCK_GAIN : BUS_GAIN, this.ctx.currentTime, 0.6)
    }
  }

  // 游戏状态 → 音乐强度：飞机相对风速越快，主旋律越响越亮；停滞时只剩伴奏呼吸
  setFlow(x: number) {
    const v = Math.max(0, Math.min(1, x))
    const t = this.ctx.currentTime
    this.melBus.gain.setTargetAtTime(0.25 + 0.75 * v, t, 0.5)
    this.melLp.frequency.setTargetAtTime(900 + 2400 * v, t, 0.5)
  }

  private stopTimer() {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  // 调度基准用 ctx.currentTime 而非 performance.now()：页面隐藏 ctx.suspend 后
  // 音频时钟冻结，调度自然暂停，恢复可见无缝续播，绝不积压
  private pump = () => {
    const score = this.score
    if (!score) return
    const loopSteps = score.bars * 8
    const horizon = this.ctx.currentTime + SCHED_AHEAD
    while (this.startAt + this.nextStep * this.secPerStep < horizon) {
      const loopStep = this.nextStep % loopSteps
      const t = this.startAt + this.nextStep * this.secPerStep
      for (const n of score.bass) if (Math.round(n.beat * 2) === loopStep) this.bassVoice(n, t)
      for (const n of score.arp) if (Math.round(n.beat * 2) === loopStep) this.arpVoice(n, t)
      // 伴奏先铺一遍再进主旋律（奇数遍全奏），编制起伏不靠烘焙靠排程
      if (Math.floor(this.nextStep / loopSteps) % 2 === 1) {
        for (const n of score.theme) if (Math.round(n.beat * 2) === loopStep) this.themeVoice(n, t)
      }
      this.nextStep++
    }
  }

  private bassVoice(n: ScoreNote, t: number) {
    const osc = this.ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = midiFreq(n.midi)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.2 * n.vel, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55)
    osc.connect(g)
    g.connect(this.bus)
    osc.start(t)
    osc.stop(t + 0.75)
    this.releaseWhenDone(osc, [osc, g])
  }

  private arpVoice(n: ScoreNote, t: number) {
    const osc = this.ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = midiFreq(n.midi)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.26 * n.vel, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
    osc.connect(g)
    g.connect(this.bus)
    osc.start(t)
    osc.stop(t + 0.7)
    this.releaseWhenDone(osc, [osc, g])
  }

  // FM 钢片琴：载波 sine + 2 倍频调制（泛音随包络衰减），八音盒的明亮晶莹
  private themeVoice(n: ScoreNote, t: number) {
    const f = midiFreq(n.midi)
    const car = this.ctx.createOscillator()
    car.type = 'sine'
    car.frequency.value = f
    const mod = this.ctx.createOscillator()
    mod.type = 'sine'
    mod.frequency.value = f * 2
    const mg = this.ctx.createGain()
    mg.gain.setValueAtTime(f * 2.6, t)
    mg.gain.exponentialRampToValueAtTime(Math.max(1, f * 0.05), t + 0.6)
    mod.connect(mg)
    mg.connect(car.frequency)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.4 * n.vel, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9)
    car.connect(g)
    g.connect(this.melBus)
    g.connect(this.delaySend)
    car.start(t)
    mod.start(t)
    car.stop(t + 1.1)
    mod.stop(t + 1.1)
    this.releaseWhenDone(car, [car, mod, mg, g])
  }

  private releaseWhenDone(src: OscillatorNode, nodes: AudioNode[]) {
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
      window.setTimeout(cleanup, 8000)
    }
  }
}
