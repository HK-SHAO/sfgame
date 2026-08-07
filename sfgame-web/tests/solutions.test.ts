import { expect, test } from 'vitest'
import { codecs } from '../app/core/url-state'
import { LEVELS } from '../app/game/levels'
import { LevelSimulation } from '../app/game/simulation'
import { SOLUTIONS, solutionUrl, solutionsFor } from '../app/game/solutions'
import { sourceItem } from '../app/game/state'
import type { LevelDef, SourcePlacement } from '../app/game/types'

const DT = 1 / 60
// 留足余量：实测参考解最长约 24s
const WIN_CAP = 45

function winTime(level: LevelDef, sources: SourcePlacement[]): number {
  const sim = new LevelSimulation(level)
  for (const s of sources) sim.placeSource(s.x, s.y, s.kind)
  for (let t = 0; t < WIN_CAP; t += DT) {
    sim.step(DT)
    if (sim.phase === 'won') return t
  }
  return -1
}

test('所有关卡均有注册解，且源数量不超预算', () => {
  expect(Object.keys(SOLUTIONS).length).toBeGreaterThan(0)
  for (const level of LEVELS) {
    expect(solutionsFor(level.id).length, `${level.id} 无解`).toBeGreaterThan(0)
    for (const s of solutionsFor(level.id)) {
      expect(s.sources.filter((x) => x.kind === 'hot').length).toBeLessThanOrEqual(level.budget.hot)
      expect(s.sources.filter((x) => x.kind === 'cold').length).toBeLessThanOrEqual(level.budget.cold)
    }
  }
})

test('每个解：初始一次性放置即通关，实测时间与记录一致（±2s）', () => {
  for (const level of LEVELS) {
    for (const s of solutionsFor(level.id)) {
      const t = winTime(level, s.sources)
      expect(t, `${level.id}「${s.name}」未在 ${WIN_CAP}s 内通关`).toBeGreaterThan(0)
      expect(Math.abs(t - s.winTime), `${level.id}「${s.name}」通关时间与记录不符`).toBeLessThan(2)
    }
  }
}, 30000)

test('solutionUrl：往返一致、零百分号编码，保留其他状态并清视图标记', () => {
  const sources = codecs.list<SourcePlacement>([], sourceItem, '_')
  for (const level of LEVELS) {
    for (const s of solutionsFor(level.id)) {
      const url = solutionUrl(level.id, s)
      const params = new URLSearchParams(url)
      expect(params.get('lv')).toBe(String(level.id))
      expect(sources.decode(params.get('src'))).toEqual(s.sources)
      expect(url).not.toMatch(/%/)
    }
  }
  const base = new URLSearchParams('dev=1&v=solutions&src=1-2-h')
  const params = new URLSearchParams(solutionUrl(LEVELS[0].id, solutionsFor(LEVELS[0].id)[0], base))
  expect(params.get('dev')).toBe('1')
  expect(params.get('v')).toBeNull()
})
