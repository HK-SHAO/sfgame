import { describe, expect, it } from 'vitest'
import { bakeScore, renderStems, type ScoreNote } from '../app/core/music'
import { createEngine } from '../app/wasm/engine'

// 音乐合成内核（WASM 物理建模钢琴）白盒：渲染确定性、输出有效、性能预算
// 与游戏内同一渲染路径（MusicPlayer.bakeStem 的同步版），试听脚本亦同

function renderStem(notes: ScoreNote[], kind: number, secPerBeat: number, loopSec: number): Float32Array {
  const eng = createEngine()
  const { ex, memory } = eng
  const n = ex.mClear(loopSec)
  const sv = new Float64Array(memory.buffer, ex.mScoreBuf(), notes.length * 4)
  for (let i = 0; i < notes.length; i++) {
    sv[i * 4] = notes[i].midi
    sv[i * 4 + 1] = notes[i].beat * secPerBeat
    sv[i * 4 + 2] = notes[i].beats * secPerBeat
    sv[i * 4 + 3] = notes[i].vel
  }
  ex.mRender(kind, notes.length)
  return new Float32Array(memory.buffer, ex.mPcmBuf(), n).slice()
}

describe('音乐合成内核（WASM）', () => {
  const score = bakeScore(1)
  const secPerBeat = 60 / score.bpm
  const loopSec = score.bars * 4 * secPerBeat

  it('确定性：同乐谱两次渲染逐位一致', () => {
    const a = renderStem(score.theme, 2, secPerBeat, loopSec)
    const b = renderStem(score.theme, 2, secPerBeat, loopSec)
    expect(a.length).toBe(b.length)
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true)
  }, 15000)

  it('输出有效：长度精确、非零、无 NaN、幅度有界', () => {
    const pcm = renderStem(score.theme, 2, secPerBeat, loopSec)
    expect(pcm.length).toBe(Math.ceil(loopSec * 44100))
    let peak = 0
    let nonzero = 0
    for (const v of pcm) {
      expect(Number.isFinite(v)).toBe(true)
      peak = Math.max(peak, Math.abs(v))
      if (v !== 0) nonzero++
    }
    expect(peak).toBeGreaterThan(0.05)
    expect(peak).toBeLessThan(1.5)
    expect(nonzero / pcm.length).toBeGreaterThan(0.5)
  }, 15000)

  it('循环无缝：尾音折回头部，边界两侧均非零（无硬回卷静音缝）', () => {
    const pcm = renderStem(score.theme, 2, secPerBeat, loopSec)
    const head = pcm.slice(0, 4410).reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    const tail = pcm.slice(-4410).reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    expect(head).toBeGreaterThan(0.001)
    expect(tail).toBeGreaterThan(0.001)
  }, 15000)

  it('性能预算：三轨全量烘焙在 8s 内（分片后游戏内无感）', () => {
    const eng = createEngine()
    const { ex, memory } = eng
    const t0 = performance.now()
    ex.mClear(loopSec)
    for (const [notes, kind] of [
      [score.bass, 0],
      [score.arp, 1],
      [score.theme, 2],
    ] as Array<[ScoreNote[], number]>) {
      const sv = new Float64Array(memory.buffer, ex.mScoreBuf(), notes.length * 4)
      for (let i = 0; i < notes.length; i++) {
        sv[i * 4] = notes[i].midi
        sv[i * 4 + 1] = notes[i].beat * secPerBeat
        sv[i * 4 + 2] = notes[i].beats * secPerBeat
        sv[i * 4 + 3] = notes[i].vel
      }
      ex.mRender(kind, notes.length)
    }
    expect(performance.now() - t0).toBeLessThan(8000)
  }, 15000)

  it('renderStems：两 stem 有效且进度走完（Worker 烘焙同一路径）', () => {
    let last = 0
    let total = 0
    const stems = renderStems(createEngine(), score, (done, t) => {
      last = done
      total = t
    })
    expect(total).toBeGreaterThan(0)
    expect(last).toBe(total)
    for (const pcm of [stems.accomp, stems.theme]) {
      expect(pcm.length).toBe(Math.ceil(loopSec * 44100))
      let peak = 0
      let allFinite = true
      for (const v of pcm) {
        if (!Number.isFinite(v)) allFinite = false
        peak = Math.max(peak, Math.abs(v))
      }
      expect(allFinite).toBe(true)
      expect(peak).toBeGreaterThan(0.01)
    }
  }, 15000)
})
