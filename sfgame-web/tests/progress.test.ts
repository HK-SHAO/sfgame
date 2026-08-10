import { expect, test } from 'vitest'
import { PlayerProgress, type ProgressStorage } from '../app/game/progress'

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

test('只记最佳：新纪录覆盖、非新纪录返回 -1、completed 反映有无记录', () => {
  const { storage } = memStorage()
  const p = new PlayerProgress(storage)
  const entry = (time: number, extra = 0, at: number) => ({ time, extra, at })
  expect(p.record('h1', entry(20, 0, 1))).toBe(0)
  expect(p.record('h1', entry(15, 0, 2))).toBe(0)
  expect(p.record('h1', entry(30, 0, 3))).toBe(-1)
  expect(p.best('h1')?.total).toBe(15)
  // 同总耗时不算新纪录（稳定排序语义）
  expect(p.record('h1', entry(15, 0, 4))).toBe(-1)
  expect(p.record('h1', entry(10, 2, 5))).toBe(0)
  expect(p.best('h1')?.total).toBe(12)
  // 不同 hash 互不影响（关卡改版/内联 DIY 不串号）
  expect(p.best('h2')).toBeUndefined()

  const q = new PlayerProgress(memStorage().storage)
  expect(q.completed('h1')).toBe(false)
  q.record('h1', { time: 9, extra: 0, at: 1 })
  expect(q.completed('h1')).toBe(true)
})

test('旧版 top3 数组载荷兼容：取最优一条，多余字段忽略', () => {
  const old = memStorage()
  old.storage.set(
    JSON.stringify({
      v: 1,
      levels: {
        h1: [
          { time: 'x', extra: 0, at: 1 },
          { time: 5, extra: 0, sources: [{ x: 1, y: 2, kind: 'hot' }], at: 2 },
          { time: 6, extra: 1, sources: [], at: 3 },
          { time: 7, extra: 2, at: 4 },
        ],
      },
    }),
  )
  const p = new PlayerProgress(old.storage)
  expect(p.best('h1')?.total).toBe(5)
  // 单条非数组载荷也可读
  old.storage.set(JSON.stringify({ v: 1, levels: { h1: { time: 8, extra: 1, at: 1 } } }))
  expect(new PlayerProgress(old.storage).best('h1')?.total).toBe(9)
})

test('损坏数据容错：非法 JSON/未知版本/非法条目安全回落', () => {
  const bad = memStorage()
  bad.storage.set('not-json{{')
  expect(new PlayerProgress(bad.storage).best('h1')).toBeUndefined()

  const vOld = memStorage()
  vOld.storage.set(JSON.stringify({ v: 2, levels: {} }))
  expect(new PlayerProgress(vOld.storage).best('h1')).toBeUndefined()
})
