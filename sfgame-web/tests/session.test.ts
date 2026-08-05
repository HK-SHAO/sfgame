import { expect, test } from 'vitest'
import { LEVEL_1, LEVELS, levelSource } from '../src/game/levels'
import { DEV_SLOT, getDevOverrideText, resolveLevel, setDevOverride } from '../src/game/session'

test('levelSource：返回内置关卡原始 YAML（dev 面板预填）', () => {
  const src = levelSource(1)
  expect(src).toBeDefined()
  expect(src).toContain('schema: 1')
  expect(src).toContain('降落')
})

test('lv=0 槽：无覆写时即第 1 关', () => {
  expect(resolveLevel(DEV_SLOT)).toBe(LEVEL_1)
  expect(getDevOverrideText()).toBeUndefined()
})

test('setDevOverride：合法 YAML 覆写 lv=0 槽', () => {
  const text = `${levelSource(1)!.replace('tagline: 下沉气流', 'tagline: 测试覆写')}`
  const level = setDevOverride(text)
  expect(level.tagline).toBe('测试覆写')
  expect(resolveLevel(DEV_SLOT)).toBe(level)
  expect(getDevOverrideText()).toBe(text)
  // 普通关卡不受影响
  expect(resolveLevel(1)).toBe(LEVELS.find((l) => l.id === 1))
  expect(resolveLevel(2)).toBe(LEVELS.find((l) => l.id === 2))
})

test('setDevOverride：非法 YAML 抛校验错误且不写入', () => {
  expect(() => setDevOverride('schema: 1\nid: 1\n')).toThrow(/校验失败/)
  // 上一条用例已写入 → 覆写仍是那条
  expect(getDevOverrideText()).toContain('测试覆写')
})

test('resolveLevel：不存在的 id 返回 undefined', () => {
  expect(resolveLevel(99)).toBeUndefined()
})
