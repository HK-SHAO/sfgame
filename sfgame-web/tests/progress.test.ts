import { expect, test } from 'vitest'
import { PlayerProgress, PROGRESS_TOP_N, type ProgressStorage } from '../src/game/progress'
import type { SourcePlacement } from '../src/game/types'

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

test('record：按合计耗时升序，只留 TOP_N 条，返回该次排名', () => {
  const { storage } = memStorage()
  const p = new PlayerProgress(storage)
  const entry = (time: number, extra = 0, at: number) => ({ time, extra, sources: [] as SourcePlacement[], at })
  expect(p.record(1, entry(20, 0, 1))).toBe(0)
  expect(p.record(1, entry(15, 0, 2))).toBe(0)
  expect(p.record(1, entry(30, 0, 3))).toBe(2)
  expect(p.record(1, entry(25, 0, 4))).toBe(2)
  expect(p.record(1, entry(10, 0, 5))).toBe(0)
  // 榜内只有最优 3 条；合计 = time + extra
  expect(p.best(1).map((s) => s.total)).toEqual([10, 15, 20])
  expect(p.best(1)).toHaveLength(PROGRESS_TOP_N)
  // 未进榜
  expect(p.record(1, entry(99, 0, 6))).toBe(-1)
  expect(p.best(1)).toHaveLength(PROGRESS_TOP_N)
  // 各关成绩互不干扰
  p.record(2, entry(5, 2, 7))
  expect(p.best(2)[0].total).toBe(7)
  expect(p.best(1)).toHaveLength(PROGRESS_TOP_N)
})

test('record：解法摆放随成绩记录并保留', () => {
  const p = new PlayerProgress(memStorage().storage)
  const sources: SourcePlacement[] = [
    { x: 20, y: 44, kind: 'hot' },
    { x: 50, y: 21.3, kind: 'cold' },
  ]
  p.record(3, { time: 16.8, extra: 8, sources })
  expect(p.best(3)[0].sources).toEqual(sources)
  expect(p.best(3)[0].total).toBeCloseTo(24.8, 5)
})

test('解锁规则：第 1 关恒解锁，其余需上一关通关', () => {
  const p = new PlayerProgress(memStorage().storage)
  expect(p.isUnlocked(1)).toBe(true)
  expect(p.isUnlocked(2)).toBe(false)
  expect(p.isUnlocked(5)).toBe(false)
  expect(p.completed(2)).toBe(false)
  // 解锁只由上一关通关决定：通关第 2 关 → 第 3 关解锁（第 2 关本身仍锁）
  p.record(2, { time: 10, extra: 0, sources: [] })
  expect(p.isUnlocked(2)).toBe(false)
  expect(p.isUnlocked(3)).toBe(true)
  // 通关第 1 关解锁第 2 关；第 4 关仍锁（需第 3 关）
  p.record(1, { time: 9, extra: 0, sources: [] })
  expect(p.isUnlocked(2)).toBe(true)
  expect(p.isUnlocked(4)).toBe(false)
  p.record(3, { time: 12, extra: 0, sources: [] })
  expect(p.isUnlocked(4)).toBe(true)
})

test('持久化往返：重载后数据一致，且解法可恢复', () => {
  const { storage, raw } = memStorage()
  const p = new PlayerProgress(storage)
  p.record(1, { time: 12.5, extra: 4, sources: [{ x: 20, y: 44, kind: 'hot' }] })
  const reloaded = new PlayerProgress(storage)
  expect(reloaded.best(1)).toEqual(p.best(1))
  expect(raw()).toContain('20')
  expect(raw()).toContain('hot')
})

test('损坏数据容错：非法 JSON/未知版本/非法条目全部安全回落', () => {
  // 非法 JSON
  const bad = memStorage()
  bad.storage.set('not-json{{')
  expect(new PlayerProgress(bad.storage).best(1)).toEqual([])
  // 版本不匹配 → 空进度
  const v2 = memStorage()
  v2.storage.set(JSON.stringify({ v: 2, levels: {} }))
  expect(new PlayerProgress(v2.storage).best(1)).toEqual([])
  // 非法条目逐条丢弃（核心字段非数字）；源摆放非法只清空该条的解法，不丢成绩
  const dirty = memStorage()
  dirty.storage.set(
    JSON.stringify({
      v: 1,
      levels: {
        '1': [
          { time: 'x', extra: 0, at: 1 },
          { time: 5, extra: 0, sources: [{ x: 'a' }], at: 2 },
          { time: 6, extra: 1, sources: [{ x: 1, y: 2, kind: 'warm' }], at: 3 },
          { time: 7, extra: 2, sources: [{ x: 1, y: 2, kind: 'hot' }], at: 4 },
        ],
      },
    }),
  )
  const d = new PlayerProgress(dirty.storage)
  expect(d.best(1)).toHaveLength(3)
  expect(d.best(1).map((s) => s.total)).toEqual([5, 7, 9])
  expect(d.best(1)[2].sources).toEqual([{ x: 1, y: 2, kind: 'hot' }])
  expect(d.best(1)[0].sources).toEqual([])
  // 非法关卡结构（非数组）跳过
  const weird = memStorage()
  weird.storage.set(JSON.stringify({ v: 1, levels: { '1': 'oops' } }))
  expect(new PlayerProgress(weird.storage).best(1)).toEqual([])
})
