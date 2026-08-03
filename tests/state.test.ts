import { expect, test } from 'vitest'
import { codecs } from '../src/core/url-state'
import { num, sourceItem, urlState } from '../src/game/state'
import type { SourcePlacement } from '../src/game/types'

test('坐标编码：整数去尾部 .0，保留 1 位小数', () => {
  expect(num(20)).toBe('20')
  expect(num(20.4)).toBe('20.4')
  expect(num(20.05)).toBe('20.1')
  expect(sourceItem.encode({ x: 20, y: 44, kind: 'hot' })).toBe('20-44-h')
  expect(sourceItem.encode({ x: 20.4, y: 44.1, kind: 'cold' })).toBe('20.4-44.1-c')
})

test('往返稳定：encode → decode 得同一 1 位小数坐标', () => {
  const cases: SourcePlacement[] = [
    { x: 20, y: 44, kind: 'hot' },
    { x: 36.3, y: 28, kind: 'hot' },
    { x: 50, y: 16.7, kind: 'cold' },
  ]
  for (const s of cases) {
    const decoded = sourceItem.decode(sourceItem.encode(s))
    expect(decoded).toEqual({
      x: Math.round(s.x * 10) / 10,
      y: Math.round(s.y * 10) / 10,
      kind: s.kind,
    })
  }
})

test('非法项返回 null（列表整体丢弃）', () => {
  expect(sourceItem.decode('a-b-c')).toBeNull()
  expect(sourceItem.decode('20-44-x')).toBeNull()
  expect(sourceItem.decode('20-44')).toBeNull()
  expect(sourceItem.decode('')).toBeNull()
})

test('sources 参数整体编解码，全程零百分号字符', () => {
  const list = codecs.list<SourcePlacement>([], sourceItem, '_')
  const raw = list.encode([
    { x: 20, y: 44, kind: 'hot' },
    { x: 36, y: 28, kind: 'cold' },
  ])
  expect(raw).toBe('20-44-h_36-28-c')
  expect(raw).not.toMatch(/%/)
  expect(list.decode(raw)).toEqual([
    { x: 20, y: 44, kind: 'hot' },
    { x: 36, y: 28, kind: 'cold' },
  ])
  // 非法元素被丢弃，合法元素保留
  expect(list.decode('20-44-h_bad_x-9-h')).toEqual([{ x: 20, y: 44, kind: 'hot' }])
})

test('schema 单例：level/dev 解码正常（无头环境下浏览器适配器静默）', () => {
  expect(urlState.get('level')).toBeNull()
  expect(urlState.get('sources')).toEqual([])
  expect(urlState.get('dev')).toBe(false)
})
