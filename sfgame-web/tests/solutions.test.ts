import { expect, test } from 'vitest'
import { LEVELS, solutionsFor } from '../app/game/levels'

// 解法可通关性与 winTime 由玩家实测（#25/#27 起不守护：关卡玩法可能调整，求解交给玩家）；
// 参考解只作为 dev 模式首页关卡项的直达摆法数据

test('所有关卡均有注册解，且源数量不超预算', () => {
  expect(LEVELS.length).toBeGreaterThan(0)
  for (const level of LEVELS) {
    expect(solutionsFor(level.id).length, `${level.id} 无解`).toBeGreaterThan(0)
    for (const s of solutionsFor(level.id)) {
      expect(s.sources.filter((x) => x.kind === 'hot').length).toBeLessThanOrEqual(level.budget.hot)
      expect(s.sources.filter((x) => x.kind === 'cold').length).toBeLessThanOrEqual(level.budget.cold)
    }
  }
})
