import { expect, test } from 'vitest'
import { PlayerProgress, PROGRESS_TOP_N, type ProgressStorage } from '../app/game/progress'
import type { SourcePlacement } from '../app/game/types'

function memStorage(): { storage: ProgressStorage; raw(): string | null } {
  let raw: string | null = null
  return {
    storage: {
      get: () => raw,
      set: (v) => {
        raw = v
      },
    },
    raw: () => raw,
  }
}

test('记录排名：TOP_N 升序留榜、返回名次、completed 反映有无记录', () => {
  const { storage } = memStorage()
  const p = new PlayerProgress(storage)
  const entry = (time: number, extra = 0, at: number) => ({ time, extra, sources: [] as SourcePlacement[], at })
  expect(p.record('h1', entry(20, 0, 1))).toBe(0)
  expect(p.record('h1', entry(15, 0, 2))).toBe(0)
  expect(p.record('h1', entry(30, 0, 3))).toBe(2)
  expect(p.record('h1', entry(99, 0, 6))).toBe(-1)
  expect(p.best('h1').map((s) => s.total)).toEqual([15, 20, 30])
  p.record('h1', entry(10, 0, 7))
  p.record('h1', entry(25, 0, 8))
  expect(p.best('h1').map((s) => s.total)).toEqual([10, 15, 20])
  expect(p.best('h1')).toHaveLength(PROGRESS_TOP_N)
  // 不同 hash 互不影响（关卡改版/内联 DIY 不串号）
  expect(p.best('h2')).toEqual([])

  const q = new PlayerProgress(memStorage().storage)
  expect(q.completed('h1')).toBe(false)
  q.record('h1', { time: 9, extra: 0, sources: [] })
  expect(q.completed('h1')).toBe(true)
})

test('损坏数据容错：非法 JSON/未知版本/非法条目安全回落', () => {
  const bad = memStorage()
  bad.storage.set('not-json{{')
  expect(new PlayerProgress(bad.storage).best('h1')).toEqual([])

  const vOld = memStorage()
  vOld.storage.set(JSON.stringify({ v: 1, levels: {} }))
  expect(new PlayerProgress(vOld.storage).best('h1')).toEqual([])

  const dirty = memStorage()
  dirty.storage.set(
    JSON.stringify({
      v: 2,
      levels: {
        h1: [
          { time: 'x', extra: 0, at: 1 },
          { time: 5, extra: 0, sources: [{ x: 'a' }], at: 2 },
          { time: 6, extra: 1, sources: [{ x: 1, y: 2, kind: 'warm' }], at: 3 },
          { time: 7, extra: 2, sources: [{ x: 1, y: 2, kind: 'hot' }], at: 4 },
        ],
      },
    }),
  )
  const d = new PlayerProgress(dirty.storage)
  expect(d.best('h1').map((s) => s.total)).toEqual([5, 7, 9])
  expect(d.best('h1')[2].sources).toEqual([{ x: 1, y: 2, kind: 'hot' }])
  expect(d.best('h1')[0].sources).toEqual([])
})
