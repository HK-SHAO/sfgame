import { expect, test } from 'vitest'
import { codecs } from '../src/core/url-state'
import { sourceItem } from '../src/game/state'
import type { SourcePlacement } from '../src/game/types'

test('源编解码：1 位小数往返稳定、非法项丢弃、全程零百分号', () => {
  const cases: SourcePlacement[] = [
    { x: 20, y: 44, kind: 'hot' },
    { x: 36.3, y: 28, kind: 'hot' },
    { x: 50, y: 16.7, kind: 'cold' },
  ]
  for (const s of cases) {
    expect(sourceItem.decode(sourceItem.encode(s))).toEqual({
      x: Math.round(s.x * 10) / 10,
      y: Math.round(s.y * 10) / 10,
      kind: s.kind,
    })
  }
  expect(sourceItem.encode({ x: 20, y: 44, kind: 'hot' })).toBe('20-44-h')
  expect(sourceItem.decode('a-b-c')).toBeNull()
  expect(sourceItem.decode('20-44-x')).toBeNull()
  expect(sourceItem.decode('20-44')).toBeNull()

  const list = codecs.list<SourcePlacement>([], sourceItem, '_')
  const raw = list.encode([
    { x: 20, y: 44, kind: 'hot' },
    { x: 36, y: 28, kind: 'cold' },
  ])
  expect(raw).toBe('20-44-h_36-28-c')
  expect(raw).not.toMatch(/%/)
  expect(list.decode('20-44-h_bad_x-9-h')).toEqual([{ x: 20, y: 44, kind: 'hot' }])
})
