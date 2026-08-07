import { expect, test } from 'vitest'
import { parse as parseYaml, stringify as yamlStringify } from 'yaml'
import { LEVELS, levelSource } from '../app/game/levels'
import { parseLevelText } from '../app/game/level-format'
import { resolveLevel } from '../app/game/session'
import { lvCodec } from '../app/game/state'

const levelJson = (id: number) => JSON.stringify(parseYaml(levelSource(id)!))

test('内置关卡：id 解析，无效 id 回落 undefined', () => {
  expect(resolveLevel(6)).toBe(LEVELS.find((l) => l.id === 6))
  expect(resolveLevel(null)).toBeUndefined()
  expect(resolveLevel(99)).toBeUndefined()
  expect(resolveLevel('')).toBeUndefined()
  expect(resolveLevel('abc')).toBeUndefined()
})

test('数字形态无数量上限：任意正整数即 id，超精度回落', () => {
  expect(lvCodec.decode('100')).toBe(100)
  expect(lvCodec.decode('999')).toBe(999)
  expect(resolveLevel(100)).toBeUndefined()
  expect(lvCodec.decode('99999999999999999999')).toBeNull()
})

test('内联关卡：JSON 压入 lv 往返无损，URL 零百分号转义', () => {
  const json = levelJson(6)
  const url = lvCodec.encode(json)
  // 与 node 标准 base64url 对照：防编码自洽但字母表/位序错误的盲区
  expect(url).toBe(Buffer.from(json).toString('base64url'))
  // 不变量：JSON 以 '{' 开头 → 首字符恒为 'e' 绝非数字，数字形态才判为 id
  expect(url[0]).toBe('e')
  expect(url).not.toMatch(/%/)
  // URLSearchParams 传递不损坏
  const params = new URLSearchParams()
  params.set('lv', url)
  expect(params.get('lv')).toBe(url)
  expect(lvCodec.decode(url)).toBe(json)
  expect(url.length).toBeLessThan(json.length * 2)
  expect(resolveLevel(json)?.id).toBe(6)
})

test('内联关卡经 yaml.stringify 重建后语义等值（预填路径）', () => {
  const json = levelJson(6)
  const rebuilt = yamlStringify(JSON.parse(json))
  expect(JSON.stringify(parseLevelText(rebuilt))).toBe(json)
})

test('损坏/非法内联编码回落，整数形态拒绝 lv=0', () => {
  expect(resolveLevel(lvCodec.decode('garbage') ?? '')).toBeUndefined()
  expect(lvCodec.decode('0')).toBeNull()
  expect(lvCodec.encode('')).toBe('')
  expect(lvCodec.decode('')).toBeNull()
})
