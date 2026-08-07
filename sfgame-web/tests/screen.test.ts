import { expect, test } from 'vitest'
import { deriveScreen } from '../app/game/screen'
import { LEVEL_1, LEVELS } from '../app/game/levels'
import type { SourcePlacement } from '../app/game/types'

const sources: SourcePlacement[] = [{ x: 20, y: 44, kind: 'hot' }]

test('v 优先于 lv：页面键与关卡共存时以页面为准', () => {
  expect(deriveScreen('solutions', 1, sources).screen).toBe('solutions')
  expect(deriveScreen('dev', 1, sources).screen).toBe('dev')
  expect(deriveScreen('storage', 1, sources).screen).toBe('storage')
  for (const v of ['solutions', 'dev', 'storage'] as const) {
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

test('lv=0 开发槽：无覆写时回落第 1 关', () => {
  const s = deriveScreen('title', 0, [])
  expect(s.screen).toBe('game')
  expect(s.level?.id).toBe(LEVEL_1.id)
})
