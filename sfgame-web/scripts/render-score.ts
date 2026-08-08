// 背景音乐/音效离线试听：bakeScore 乐谱 + sfx 个性音色 → WAV（纯加法合成，复刻 MusicPlayer/Sfx 参数）
// 用法：bun run scripts/render-score.ts [seed]  →  .local/bgm-v2.wav + .local/sfx-v2.wav
// bgm 两遍结构 = 游戏内编制：第一遍纯伴奏铺底，第二遍进根本旋律（FM 钢片琴）
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bakeScore, type BgmScore, type ScoreNote } from '../app/core/music'

const SR = 44100
const BUS_GAIN = 0.22 // 与 MusicPlayer 一致

const midiFreq = (m: number) => 440 * 2 ** ((m - 69) / 12)
const tri = (p: number) => (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * p))
const lin = (f0: number, f1: number, dur: number) => (t: number) => f0 + ((f1 - f0) * t) / dur

// 与 MusicPlayer 同款包络：8ms 线性快攻 + 指数衰减
function addNote(
  mix: Float64Array,
  echo: Float64Array,
  startSec: number,
  n: ScoreNote,
  type: OscillatorType,
  peak: number,
  decay: number,
  echoSend: number,
) {
  const f = midiFreq(n.midi)
  addTone(mix, echo, startSec, () => f, type, peak * n.vel, decay, echoSend)
}

// 通用单音：线性滑音（Sfx.tone 同构），echoSend>0 送入延迟链
function addTone(
  mix: Float64Array,
  echo: Float64Array,
  startSec: number,
  freq: (t: number) => number,
  type: OscillatorType,
  peak: number,
  decay: number,
  echoSend: number,
) {
  const t0 = Math.floor(startSec * SR)
  const k = Math.log(Math.max(peak, 0.001) / 0.0001) / decay
  const len = Math.min(mix.length - t0, Math.floor((decay + 0.2) * SR))
  let phase = 0
  for (let i = 0; i < len; i++) {
    const t = i / SR
    phase += (2 * Math.PI * freq(t)) / SR
    const env = t < 0.008 ? t / 0.008 : Math.exp(-k * (t - 0.008))
    const s = type === 'sine' ? Math.sin(phase) : tri(phase / (2 * Math.PI))
    const v = s * env * peak
    mix[t0 + i] += v
    if (echoSend > 0) echo[t0 + i] += v * echoSend
  }
}

// FM 合成（Sfx.fmTone/MusicPlayer.themeVoice 同构）：载波 sine + ratio 倍频调制，泛音随包络衰减
function addFm(
  mix: Float64Array,
  echo: Float64Array,
  startSec: number,
  f: number,
  peak: number,
  dur: number,
  ratio: number,
  index: number,
  echoSend: number,
) {
  const t0 = Math.floor(startSec * SR)
  const kAmp = Math.log(Math.max(peak, 0.001) / 0.0001) / dur
  const kMod = Math.log(index / 0.05) / (dur * 0.7)
  const len = Math.min(mix.length - t0, Math.floor((dur + 0.2) * SR))
  for (let i = 0; i < len; i++) {
    const t = i / SR
    const env = t < 0.008 ? t / 0.008 : Math.exp(-kAmp * (t - 0.008))
    const beta = (index * Math.exp(-kMod * t) + 0.05) / ratio
    const v = Math.sin(2 * Math.PI * f * t + beta * Math.sin(2 * Math.PI * ratio * f * t)) * env * peak
    mix[t0 + i] += v
    if (echoSend > 0) echo[t0 + i] += v * echoSend
  }
}

// 噪声脉冲（Sfx.noiseBurst 同构）：白噪声 + 一阶低通 + 指数衰减
function addNoise(mix: Float64Array, startSec: number, cutoff: number, dur: number, peak: number) {
  const t0 = Math.floor(startSec * SR)
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / SR)
  const k = Math.log(Math.max(peak, 0.001) / 0.0001) / dur
  const len = Math.min(mix.length - t0, Math.floor((dur + 0.05) * SR))
  let lp = 0
  for (let i = 0; i < len; i++) {
    const t = i / SR
    lp += a * ((Math.random() * 2 - 1) - lp)
    mix[t0 + i] += lp * Math.exp(-k * t) * peak * 2.2
  }
}

// 与 MusicPlayer 延迟链同构：延迟 → 反馈低通 → 回馈；wet 混入总线
function applyDelay(mix: Float64Array, echo: Float64Array, time: number, fb: number, wet: number, lpHz: number) {
  const dLen = Math.floor(time * SR)
  const a = 1 - Math.exp((-2 * Math.PI * lpHz) / SR)
  const line = new Float64Array(mix.length)
  let lp = 0
  for (let i = 0; i < mix.length; i++) {
    const out = i >= dLen ? line[i - dLen] : 0
    lp += a * (out - lp)
    line[i] = echo[i] + lp * fb
    mix[i] += out * wet
  }
}

function renderBgm(score: BgmScore): Float64Array {
  const secPerBeat = 60 / score.bpm
  const loopBeats = score.bars * 4
  const len = Math.ceil((loopBeats * secPerBeat * 2 + 2) * SR)
  const mix = new Float64Array(len)
  const echo = new Float64Array(len)
  for (let loop = 0; loop < 2; loop++) {
    const base = loop * loopBeats * secPerBeat
    for (const n of score.bass) addNote(mix, echo, base + n.beat * secPerBeat, n, 'sine', 0.2, 0.55, 0)
    for (const n of score.arp) addNote(mix, echo, base + n.beat * secPerBeat, n, 'triangle', 0.26, 0.5, 0)
    // 奇数遍进主旋律（FM 钢片琴），echoSend 与 MusicPlayer.delaySend 一致
    if (loop === 1) {
      for (const n of score.theme)
        addFm(mix, echo, base + n.beat * secPerBeat, midiFreq(n.midi), 0.4 * n.vel, 0.9, 2, 2.6, 0.45)
    }
  }
  applyDelay(mix, echo, 0.26, 0.22, 0.15, 1800)
  for (let i = 0; i < len; i++) mix[i] *= BUS_GAIN
  return mix
}

// sfx 试听序列：改过个性的音色 + 未改的基准（uiClick），0.6s 间隔连播
function renderSfx(): Float64Array {
  const len = Math.ceil(7.5 * SR)
  const mix = new Float64Array(len)
  const echo = new Float64Array(len)
  let at = 0.1
  const step = (s = 0.6) => {
    const t = at
    at += s
    return t
  }
  // placeHot：下滑音 + 噪声爆点
  addTone(mix, echo, step(), lin(620, 322, 0.14), 'sine', 0.4, 0.14, 0)
  addNoise(mix, at - 0.6, 520, 0.1, 0.15)
  // placeCold：FM 冰晶双音
  addFm(mix, echo, step(), 1567.98, 0.28, 0.24, 3.07, 3.5, 0)
  addFm(mix, echo, at - 0.6 + 0.05, 2349.32, 0.13, 0.18, 3.07, 3, 0)
  // grab / remove / deny（未改，基准对照）
  addTone(mix, echo, step(0.45), lin(880, 660, 0.045), 'sine', 0.1, 0.045, 0)
  addTone(mix, echo, step(0.45), lin(659.25, 440, 0.07), 'sine', 0.3, 0.07, 0)
  addTone(mix, echo, step(0.45), () => 196, 'sine', 0.3, 0.09, 0)
  addTone(mix, echo, at - 0.45 + 0.08, () => 185, 'sine', 0.3, 0.12, 0)
  // reward：chiptune 快琶音
  const rw = step(0.7)
  ;[880, 1174.66, 1318.51, 1760].forEach((f, i) => addFm(mix, echo, rw + i * 0.05, f, 0.2, 0.13, 2, 2.2, 0))
  // win：FM 电钢终止式 + 主音长音 + 低音锚点
  const wn = step(1.6)
  ;[523.25, 659.25, 783.99, 1046.5].forEach((f, i) => addFm(mix, echo, wn + i * 0.11, f, 0.26, 0.5, 2.99, 2.6, 0))
  addFm(mix, echo, wn + 0.46, 1046.5, 0.24, 1.0, 2.99, 2.2, 0)
  addTone(mix, echo, wn + 0.46, () => 130.81, 'sine', 0.16, 0.9, 0)
  // uiClick（未改基准）
  addTone(mix, echo, step(0.45), () => 950, 'sine', 0.15, 0.04, 0)
  // pause on/off
  addTone(mix, echo, step(0.45), lin(392, 294, 0.08), 'sine', 0.2, 0.08, 0)
  addTone(mix, echo, step(0.45), lin(294, 392, 0.08), 'sine', 0.2, 0.08, 0)
  return mix
}

function toWav(samples: Float64Array): Buffer {
  const n = samples.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2)
  }
  return buf
}

const seed = Number(process.argv[2] ?? 1)
const outDir = fileURLToPath(new URL('../.local/', import.meta.url))
mkdirSync(outDir, { recursive: true })

const bgm = renderBgm(bakeScore(seed))
const sfx = renderSfx()
const peak = Math.max(
  bgm.reduce((m, v) => Math.max(m, Math.abs(v)), 0),
  sfx.reduce((m, v) => Math.max(m, Math.abs(v)), 0),
)
const norm = 0.89 / peak
for (const [name, pcm] of [['bgm-v2', bgm], ['sfx-v2', sfx]] as const) {
  for (let i = 0; i < pcm.length; i++) pcm[i] *= norm
  const file = `${outDir}${name}.wav`
  writeFileSync(file, toWav(pcm))
  console.log(`${file}  ${(pcm.length / SR).toFixed(1)}s`)
}
