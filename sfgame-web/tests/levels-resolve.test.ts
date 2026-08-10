import { expect, test } from 'vitest'
import { LEVELS, levelSource, resolveLevel } from '../app/game/levels'
import { parseLevelText } from '../app/game/level-format'
import { lvCodec } from '../app/game/state'

const levelJson = (id: string) => levelSource(id)!

test('内置关卡：slug 解析，无效 slug 回落 undefined', () => {
  expect(resolveLevel({ id: 'ying-huo' })).toBe(LEVELS.find((l) => l.id === 'ying-huo'))
  expect(resolveLevel(null)).toBeUndefined()
  expect(resolveLevel({ id: 'not-a-level' })).toBeUndefined()
})

test('codec 判别：slug 先验命中即归属内置，其余 fallback 试 JSON', () => {
  // slug 直传（含纯数字/含连字符的边界形态）
  expect(lvCodec.decode('ying-huo')).toEqual({ id: 'ying-huo' })
  expect(lvCodec.decode('x')).toEqual({ id: 'x' })
  expect(lvCodec.decode('3')).toEqual({ id: '3' })
  // 非 slug（大写/下划线）→ fallback base64 解码失败 → null
  expect(lvCodec.decode('Bad_Slug')).toBeNull()
  expect(lvCodec.decode('A')).toBeNull()
  expect(lvCodec.decode('garbage!')).toBeNull()
})

test('内联关卡：JSON 压入 lv 往返无损，URL 零百分号转义', () => {
  const json = levelJson('ying-huo')
  const url = lvCodec.encode({ json })
  // 与 node 标准 base64url 对照：防编码自洽但字母表/位序错误的盲区
  expect(url).toBe(Buffer.from(json).toString('base64url'))
  expect(url).not.toMatch(/%/)
  // URLSearchParams 传递不损坏
  const params = new URLSearchParams()
  params.set('lv', url)
  expect(params.get('lv')).toBe(url)
  expect(lvCodec.decode(url)).toEqual({ json })
  expect(url.length).toBeLessThan(json.length * 2)
  expect(resolveLevel({ json })?.id).toBe('ying-huo')
})

test('内联关卡经 JSON 美化重建后语义等值（预填路径）', () => {
  const json = levelJson('ying-huo')
  const rebuilt = JSON.stringify(JSON.parse(json), null, 2)
  expect(parseLevelText(rebuilt)).toEqual(JSON.parse(json))
})

test('损坏/非法内联编码回落，空值与空串一致为 null', () => {
  expect(resolveLevel(lvCodec.decode('garbage') ?? null)).toBeUndefined()
  expect(lvCodec.encode(null)).toBe('')
  expect(lvCodec.decode('')).toBeNull()
  // 合法 base64 但非 UTF-8 → null；解码成普通文本（非 JSON）→ {json}，解析留待 resolveLevel 回落
  expect(lvCodec.decode('____')).toBeNull()
  expect(lvCodec.decode('eA')).toEqual({ json: 'x' })
  expect(resolveLevel(lvCodec.decode('aGVsbG8') ?? null)).toBeUndefined()
})
