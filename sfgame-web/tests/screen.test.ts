import { expect, test } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { deriveScreen } from '../app/game/screen'
import { LEVEL_1, LEVELS, levelSource } from '../app/game/levels'
import type { SourcePlacement } from '../app/game/types'

const sources: SourcePlacement[] = [{ x: 20, y: 44, kind: 'hot' }]

test('v 优先于 lv：页面键与关卡共存时以页面为准', () => {
  expect(deriveScreen('dev', 1, sources).screen).toBe('dev')
  expect(deriveScreen('storage', 1, sources).screen).toBe('storage')
  for (const v of ['dev', 'storage'] as const) {
    expect(deriveScreen(v, 1, sources).level).toBeUndefined()
  }
})

test('v=title + 有效 lv → game，关卡与来源透传', () => {
  const s = deriveScreen('title', 1, sources)
  expect(s.screen).toBe('game')
  expect(s.level).toBe(LEVEL_1)
  expect(s.sources).toEqual(sources)
})

test('v=title + 无 lv / 无效 lv → title', () => {
  expect(deriveScreen('title', null, sources).screen).toBe('title')
  expect(deriveScreen('title', 99, sources).screen).toBe('title')
  const max = Math.max(...LEVELS.map((l) => l.id))
  expect(deriveScreen('title', max + 1, sources).screen).toBe('title')
})

test('lv=0 不再有效（旧开发槽已移除）→ title', () => {
  expect(deriveScreen('title', 0, sources).screen).toBe('title')
})

test('内联关卡 JSON → game 屏', () => {
  const json = JSON.stringify({ ...parseYaml(levelSource(1)!), tagline: '内联版' })
  const s = deriveScreen('title', json, sources)
  expect(s.screen).toBe('game')
  expect(s.level?.tagline).toBe('内联版')
  expect(s.sources).toEqual(sources)
})
