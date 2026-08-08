import { describe, expect, it } from 'vitest'
import { bakeScore } from '../app/core/music'

describe('bakeScore 程序化乐谱', () => {
  it('确定性：同种子同乐谱，且可 JSON 序列化往返', () => {
    const a = bakeScore(42)
    const b = bakeScore(42)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(JSON.parse(JSON.stringify(a))).toEqual(a)
  })

  it('关卡微调：不同种子结构同型、内容有别', () => {
    const a = bakeScore(1)
    const b = bakeScore(2)
    expect(a.bars).toBe(b.bars)
    expect(a.arp.length).toBeGreaterThanOrEqual(32)
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b))
  })

  it('和谐性：任意种子下旋律恒在五声、伴奏恒在自然大调', () => {
    const MAJOR = new Set([0, 2, 4, 5, 7, 9, 11])
    const PENTA = new Set([0, 2, 4, 7, 9])
    for (let seed = 0; seed < 20; seed++) {
      const s = bakeScore(seed)
      for (const n of [...s.bass, ...s.arp]) {
        expect(MAJOR.has((((n.midi - s.root) % 12) + 12) % 12)).toBe(true)
      }
      for (const n of s.theme) {
        expect(PENTA.has((((n.midi - s.root) % 12) + 12) % 12)).toBe(true)
      }
    }
  })

  it('规模与音域有界：根本旋律完整烘焙、无超音域音符', () => {
    for (let seed = 0; seed < 20; seed++) {
      const s = bakeScore(seed)
      expect(s.bpm).toBeGreaterThanOrEqual(78)
      expect(s.bpm).toBeLessThanOrEqual(85)
      expect(s.theme.length).toBe(36)
      expect(s.theme.every((n) => n.midi >= s.root + 12 && n.midi <= 96)).toBe(true)
      expect(s.arp.every((n) => n.midi >= s.root + 12 && n.midi <= s.root + 36)).toBe(true)
      expect(s.bass.every((n) => n.midi >= 36)).toBe(true)
    }
  })
})
