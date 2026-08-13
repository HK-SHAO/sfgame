import { expect, test } from 'vitest'
import { codecs } from '../app/core/url-state.ts'
import { lvCodec, sourceItem } from '../app/game/state.ts'
import { toBase64Url } from '../app/core/base64.ts'
import type { SourcePlacement } from '../app/game/types.ts'

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

test('lv 解码：超长内联载荷被拒（防恶意 URL 驱动无界工作量）', () => {
  // 合法载荷往返稳定（双形态）
  expect(lvCodec.decode(lvCodec.encode({ id: 'luo-yu' }))).toEqual({ id: 'luo-yu' })
  const json = JSON.stringify({ id: 'cr' })
  const encoded = lvCodec.encode({ json })
  expect(lvCodec.decode(encoded)).toEqual({ json })
  // 超限（> 16KB b64url）落 null：不进入 JSON 解析
  const big = toBase64Url(new TextEncoder().encode('{'.repeat(20_000)))
  expect(lvCodec.decode(big)).toBeNull()
})
