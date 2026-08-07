import { expect, test } from 'vitest'
import { LEVEL_1, LEVELS, levelSource } from '../app/game/levels'
import { DEV_SLOT, getDevOverrideText, resolveLevel, setDevOverride } from '../app/game/session'

test('dev 覆写：lv=0 槽生效并可预填，非法 YAML 拒绝且不覆盖，普通关卡不受影响', () => {
  expect(levelSource(1)).toContain('schema: 1')
  expect(resolveLevel(DEV_SLOT)).toBe(LEVEL_1)
  expect(resolveLevel(99)).toBeUndefined()

  const text = levelSource(1)!.replace('tagline: 下沉气流', 'tagline: 测试覆写')
  const level = setDevOverride(text)
  expect(level.tagline).toBe('测试覆写')
  expect(resolveLevel(DEV_SLOT)).toBe(level)
  expect(getDevOverrideText()).toBe(text)
  expect(resolveLevel(1)).toBe(LEVELS.find((l) => l.id === 1))

  expect(() => setDevOverride('schema: 1\nid: 1\n')).toThrow(/校验失败/)
  expect(getDevOverrideText()).toContain('测试覆写')
})
