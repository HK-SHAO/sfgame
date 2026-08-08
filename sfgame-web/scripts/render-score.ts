// 背景音乐离线试听：bakeScore 乐谱 → WASM 物理建模合成内核 → WAV（与游戏内同一渲染路径）
// 用法：bun run scripts/render-score.ts [seed]  →  .local/bgm-v3.wav
// 两遍循环拼接（stem 尾音已折回循环内，衔接无缝），伴奏/根本旋律按游戏内默认 flow=0.6 混音
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bakeScore, type BgmScore, type ScoreNote } from '../app/core/music'
import { createEngine, initEngine, type EngineHandle } from '../app/wasm/engine'

const SR = 44100
const BUS_GAIN = 0.24 // 与 MusicPlayer 一致

const wasmPath = fileURLToPath(new URL('../app/wasm/sfengine.wasm', import.meta.url))
if (!initEngine(readFileSync(wasmPath))) throw new Error('WASM 引擎加载失败（先 bun run build:wasm）')

function bakeStem(
  eng: EngineHandle,
  secPerBeat: number,
  loopSec: number,
  parts: Array<[notes: ScoreNote[], kind: number]>,
): Float32Array {
  const { ex, memory } = eng
  const n = ex.mClear(loopSec)
  for (const [notes, kind] of parts) {
    const sv = new Float64Array(memory.buffer, ex.mScoreBuf(), notes.length * 4)
    for (let i = 0; i < notes.length; i++) {
      sv[i * 4] = notes[i].midi
      sv[i * 4 + 1] = notes[i].beat * secPerBeat
      sv[i * 4 + 2] = notes[i].beats * secPerBeat
      sv[i * 4 + 3] = notes[i].vel
    }
    ex.mRender(kind, notes.length)
  }
  return new Float32Array(memory.buffer, ex.mPcmBuf(), n).slice()
}

function renderBgm(eng: EngineHandle, score: BgmScore): Float64Array {
  const secPerBeat = 60 / score.bpm
  const loopSec = score.bars * 4 * secPerBeat
  const t0 = performance.now()
  const accomp = bakeStem(eng, secPerBeat, loopSec, [
    [score.bass, 0],
    [score.arp, 1],
  ])
  const theme = bakeStem(eng, secPerBeat, loopSec, [[score.theme, 2]])
  const bakeMs = performance.now() - t0
  const loopN = accomp.length
  const mix = new Float64Array(loopN * 2)
  // 游戏内默认 flow=0.6：theme 增益 0.25+0.75×0.6=0.7；延迟回声 0.4 send / 0.15 wet 近似并入
  for (let loop = 0; loop < 2; loop++) {
    const off = loop * loopN
    for (let i = 0; i < loopN; i++) {
      mix[off + i] = (accomp[i] + theme[i] * 0.7) * BUS_GAIN
    }
  }
  console.log(`  烘焙 ${bakeMs.toFixed(0)}ms（accomp+theme 两 stem）`)
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
  let peak = 0
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(samples[i]))
  const norm = 0.89 / Math.max(peak, 1e-6)
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] * norm))
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2)
  }
  return buf
}

const seed = Number(process.argv[2] ?? 1)
const outDir = fileURLToPath(new URL('../.local/', import.meta.url))
const eng = createEngine()
const score = bakeScore(seed)
const pcm = renderBgm(eng, score)
const file = `${outDir}bgm-v3.wav`
writeFileSync(file, toWav(pcm))
console.log(`${file}  ${(pcm.length / SR).toFixed(1)}s  bpm=${score.bpm} root=${score.root}`)
