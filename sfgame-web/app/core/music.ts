// 程序化背景音乐：烘焙可序列化乐谱（纯函数，可无头测试）+ lookahead 调度播放
// 编曲思想学自 AlphaChord：万能走向 1645 驱动伴奏、根本旋律限定五声、奇偶小节疏密交错、
// 主旋律音量大于伴奏。根本旋律为人工作曲（动机重复 = 记忆点），关卡种子只做移调/走向/节奏型微调
// 自适应：setFlow(飞机相对风速) 实时驱动旋律层增益与亮度——风快音乐亮、停滞只剩伴奏

import type { EngineHandle } from '../wasm/engine'

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

const BUS_GAIN = 0.24
const DUCK_GAIN = 0.11

// 预烘焙产物：伴奏/根本旋律两段循环 PCM（44.1k 单声道）
export interface BakedStems {
  accomp: Float32Array
  theme: Float32Array
}

// 同步烘焙一首乐谱的两 stem（Worker 烘焙与无头测试共用）：mClear → bass+arp 累加 → 拷出 → mClear → theme 累加 → 拷出
// onProgress 上报已完成/总音符数（烘焙进度条）；阻塞调用方线程，主线程勿直接调（走 music-bakery）
export function renderStems(
  eng: EngineHandle,
  score: BgmScore,
  onProgress?: (done: number, total: number) => void,
): BakedStems {
  const secPerBeat = 60 / score.bpm
  const loopSec = score.bars * 4 * secPerBeat
  const { ex, memory } = eng
  const state = { done: 0, total: score.bass.length + score.arp.length + score.theme.length }
  const renderPart = (notes: ScoreNote[], kind: number) => {
    for (let off = 0; off < notes.length; off += 4) {
      const cnt = Math.min(4, notes.length - off)
      const sv = new Float64Array(memory.buffer, ex.mScoreBuf(), cnt * 4)
      for (let i = 0; i < cnt; i++) {
        const note = notes[off + i]
        sv[i * 4] = note.midi
        sv[i * 4 + 1] = note.beat * secPerBeat
        sv[i * 4 + 2] = note.beats * secPerBeat
        sv[i * 4 + 3] = note.vel
      }
      ex.mRender(kind, cnt)
      state.done += cnt
      onProgress?.(state.done, state.total)
    }
  }
  const n = ex.mClear(loopSec)
  renderPart(score.bass, 0)
  renderPart(score.arp, 1)
  const accomp = new Float32Array(memory.buffer, ex.mPcmBuf(), n).slice()
  ex.mClear(loopSec)
  renderPart(score.theme, 2)
  const theme = new Float32Array(memory.buffer, ex.mPcmBuf(), n).slice()
  return { accomp, theme }
}

// 把一组声部烘成一段循环 PCM：乐谱写入 WASM 内存 → 按音色渲染累加 → 复制出（buffer 复用）
// 分片渲染（每片 8 音符 ~150ms，片间让出主线程）：烘焙总耗 ~2s 但不卡帧，换关白场期完成
async function bakeStem(
  eng: EngineHandle,
  secPerBeat: number,
  loopSec: number,
  parts: Array<[notes: ScoreNote[], kind: number]>,
  stale: () => boolean,
): Promise<Float32Array | null> {
  const { ex, memory } = eng
  const n = ex.mClear(loopSec)
  for (const [notes, kind] of parts) {
    for (let off = 0; off < notes.length; off += 8) {
      if (stale()) return null
      const cnt = Math.min(8, notes.length - off)
      const sv = new Float64Array(memory.buffer, ex.mScoreBuf(), cnt * 4)
      for (let i = 0; i < cnt; i++) {
        const note = notes[off + i]
        sv[i * 4] = note.midi
        sv[i * 4 + 1] = note.beat * secPerBeat
        sv[i * 4 + 2] = note.beats * secPerBeat
        sv[i * 4 + 3] = note.vel
      }
      ex.mRender(kind, cnt)
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  return new Float32Array(memory.buffer, ex.mPcmBuf(), n).slice()
}

// stem 播放器：WASM 烘焙伴奏/根本旋律两段循环 PCM → AudioBufferSource 循环，播放零合成成本
// 自适应保留：theme 走独立 gain+低通（setFlow 实时调），回声链随 flow 同起伏
export class MusicPlayer {
  private ctx: AudioContext
  private eng: EngineHandle
  private bus: GainNode
  private melBus: GainNode
  private melLp: BiquadFilterNode
  private delaySend: GainNode
  private sources: AudioBufferSourceNode[] = []
  private playing = false
  private ducked = false
  // start/stop 竞态护栏：迟到的启动定时器不得复活已停的乐谱
  private gen = 0

  constructor(ctx: AudioContext, dest: AudioNode, eng: EngineHandle) {
    this.ctx = ctx
    this.eng = eng
    this.bus = ctx.createGain()
    this.bus.gain.value = 0
    this.bus.connect(dest)
    // 根本旋律层独立母线：flow 实时调增益与亮度（垂直分层混音）
    this.melBus = ctx.createGain()
    this.melBus.gain.value = 0.6
    this.melLp = ctx.createBiquadFilter()
    this.melLp.type = 'lowpass'
    this.melLp.frequency.value = 2000
    this.melBus.connect(this.melLp)
    this.melLp.connect(this.bus)
    // 共享反馈延迟链（一次创建）：附点节奏感回声，非山洞混响；不用 convolver（内存）
    this.delaySend = ctx.createGain()
    this.delaySend.gain.value = 0.4
    const delay = ctx.createDelay(1)
    delay.delayTime.value = 0.26
    const fbLp = ctx.createBiquadFilter()
    fbLp.type = 'lowpass'
    fbLp.frequency.value = 1800
    const fbGain = ctx.createGain()
    fbGain.gain.value = 0.22
    const wet = ctx.createGain()
    wet.gain.value = 0.15
    this.melLp.connect(this.delaySend)
    this.delaySend.connect(delay)
    delay.connect(fbLp)
    fbLp.connect(fbGain)
    fbGain.connect(delay)
    delay.connect(wet)
    wet.connect(this.bus)
  }

  start(score: BgmScore) {
    const gen = ++this.gen
    this.stopSources()
    this.bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3)
    void this.bakeAndStart(gen, score)
  }

  // 预烘焙 stem 直起（music-bakery 缓存命中）：启动零合成开销
  startStems(stems: BakedStems) {
    const gen = ++this.gen
    this.stopSources()
    this.bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3)
    this.launch(gen, stems.accomp, stems.theme)
  }

  private async bakeAndStart(gen: number, score: BgmScore) {
    const stale = () => gen !== this.gen
    const secPerBeat = 60 / score.bpm
    const loopSec = score.bars * 4 * secPerBeat
    const accomp = await bakeStem(this.eng, secPerBeat, loopSec, [
      [score.bass, 0],
      [score.arp, 1],
    ], stale)
    if (!accomp || stale()) return
    const theme = await bakeStem(this.eng, secPerBeat, loopSec, [[score.theme, 2]], stale)
    if (!theme || stale()) return
    this.launch(gen, accomp, theme)
  }

  private launch(gen: number, accomp: Float32Array, theme: Float32Array) {
    if (gen !== this.gen) return
    const t0 = this.ctx.currentTime + 0.1
    const mkSrc = (pcm: Float32Array, dest: AudioNode) => {
      const buf = this.ctx.createBuffer(1, pcm.length, 44100)
      buf.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0)
      const src = this.ctx.createBufferSource()
      src.buffer = buf
      src.loop = true
      src.connect(dest)
      src.start(t0)
      this.sources.push(src)
    }
    mkSrc(accomp, this.bus)
    mkSrc(theme, this.melBus)
    this.playing = true
    this.melBus.gain.setTargetAtTime(0.6, this.ctx.currentTime, 0.1)
    this.melLp.frequency.setTargetAtTime(2000, this.ctx.currentTime, 0.1)
    this.bus.gain.setTargetAtTime(this.ducked ? DUCK_GAIN : BUS_GAIN, this.ctx.currentTime, 1.4)
  }

  stop() {
    this.gen++
    this.playing = false
    this.bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4)
    // 淡出后再停 source：避免爆音
    window.setTimeout(() => this.stopSources(), 1200)
  }

  duck(on: boolean) {
    this.ducked = on
    if (this.playing) {
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

  private stopSources() {
    for (const src of this.sources) {
      try {
        src.stop()
        src.disconnect()
      } catch {
      }
    }
    this.sources = []
  }
}
