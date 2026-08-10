import { expect, test } from 'vitest'
import { deriveScreen } from '../app/game/screen.ts'
import { LEVELS_BY_ID, levelSource } from '../app/game/levels.ts'
import type { SourcePlacement } from '../app/game/types.ts'

const sources: SourcePlacement[] = [{ x: 20, y: 44, kind: 'hot' }]

test('v 优先于 lv：页面键与关卡共存时以页面为准', () => {
  expect(deriveScreen('dev', { id: 'luo-yu' }, sources).screen).toBe('dev')
  expect(deriveScreen('storage', { id: 'luo-yu' }, sources).screen).toBe('storage')
  for (const v of ['dev', 'storage'] as const) {
    expect(deriveScreen(v, { id: 'luo-yu' }, sources).level).toBeUndefined()
  }
})

test('v=title + 有效 lv → game，关卡与来源透传', () => {
  const s = deriveScreen('title', { id: 'luo-yu' }, sources)
  expect(s.screen).toBe('game')
  expect(s.level).toBe(LEVELS_BY_ID.get('luo-yu'))
  expect(s.sources).toEqual(sources)
})

test('v=title + 无 lv / 无效 lv → title', () => {
  expect(deriveScreen('title', null, sources).screen).toBe('title')
  expect(deriveScreen('title', { id: 'not-a-level' }, sources).screen).toBe('title')
  expect(deriveScreen('title', { id: 'Bad_Slug' }, sources).screen).toBe('title')
})

test('内联关卡 JSON → game 屏', () => {
  const json = JSON.stringify({ ...JSON.parse(levelSource('luo-yu')!), tagline: '内联版' })
  const s = deriveScreen('title', { json }, sources)
  expect(s.screen).toBe('game')
  expect(s.level?.tagline).toBe('内联版')
  expect(s.sources).toEqual(sources)
})

test('损坏内联 JSON → title', () => {
  const s = deriveScreen('title', { json: '{broken' }, sources)
  expect(s.screen).toBe('title')
})
