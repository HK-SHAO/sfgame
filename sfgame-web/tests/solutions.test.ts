import { expect, test } from 'vitest'
import { codecs } from '../src/core/url-state'
import { LEVELS } from '../src/game/levels'
import { LevelSimulation } from '../src/game/simulation'
import { SOLUTIONS, solutionUrl, solutionsFor } from '../src/game/solutions'
import { sourceItem } from '../src/game/state'
import type { LevelDef, SourcePlacement } from '../src/game/types'

const DT = 1 / 60
/** 通关时限：留足余量（实测参考解最长约 24s） */
const WIN_CAP = 45

/** 初始一次性放置所有源，跑确定性模拟直到通关。返回通关时刻，不通关返回 -1。 */
function winTime(level: LevelDef, sources: ReturnType<typeof solutionsFor>[number]['sources']): number {
  const sim = new LevelSimulation(level)
  for (const s of sources) sim.placeSource(s.x, s.y, s.kind)
  for (let t = 0; t < WIN_CAP; t += DT) {
    sim.step(DT)
    if (sim.phase === 'won') return t
  }
  return -1
}

test('每个关卡的解非空（解法参考页有内容）', () => {
  expect(Object.keys(SOLUTIONS).length).toBeGreaterThan(0)
})

test('每个解：源数量不超过关卡预算', () => {
  for (const level of LEVELS) {
    for (const s of solutionsFor(level.id)) {
      const hot = s.sources.filter((x) => x.kind === 'hot').length
      const cold = s.sources.filter((x) => x.kind === 'cold').length
      expect(hot, `${level.id} 热源超预算`).toBeLessThanOrEqual(level.budget.hot)
      expect(cold, `${level.id} 冷源超预算`).toBeLessThanOrEqual(level.budget.cold)
    }
  }
})

test('每个解：初始一次性放置即通关，且实测时间与记录一致（±2s）', () => {
  for (const level of LEVELS) {
    for (const s of solutionsFor(level.id)) {
      const t = winTime(level, s.sources)
      expect(t, `${level.id}「${s.name}」未在 ${WIN_CAP}s 内通关`).toBeGreaterThan(0)
      expect(Math.abs(t - s.winTime), `${level.id}「${s.name}」通关时间与记录不符`).toBeLessThan(2)
    }
  }
}, 30000)

test('solutionUrl：与 URL 状态模块往返一致，且零百分号编码', () => {
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
})
