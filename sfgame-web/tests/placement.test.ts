import { expect, test } from 'vitest'
import { levelFromJson } from '../app/game/level-format.ts'
import { LevelSimulation } from '../app/game/simulation.ts'

function mk(w: number, h: number, sdf: string) {
  return {
    id: 'cr-place', name: 't', tagline: 't', win: { title: 't', text: 't' },
    world: { w, h, cell: 0.75 }, terrain: { sdf },
    budget: { hot: 1, cold: 0 }, spawn: { x: 0 }, goals: [{ x: 20, r: 2 }],
  }
}

// 顶部禁带（R10-05 回归守护）：常规世界保留 3 单位净空；小世界按 h/6 收缩，
// 与贴地净空（0.6）之和恒 < h——旧实现 y<3 硬限令 h<3.6 的合法关卡无处放源
test('canPlaceAt：顶部禁带随世界高度比例收缩', () => {
  const normal = new LevelSimulation(levelFromJson(mk(40, 20, '8 - y')))
  expect(normal.canPlaceAt(0.5, 2.0)).toBe(false) // 顶部禁带（min(3, 20/6)=3）
  expect(normal.canPlaceAt(0.5, 3.1)).toBe(true)

  const tiny = new LevelSimulation(levelFromJson(mk(40, 4, '3.5 - y')))
  expect(tiny.canPlaceAt(0.5, 0.6)).toBe(false) // 禁带 = min(3, 4/6) ≈ 0.667
  expect(tiny.canPlaceAt(0.5, 2.0)).toBe(true) // 旧实现 y<3 时此处恒拒绝 → 小世界无解
})
