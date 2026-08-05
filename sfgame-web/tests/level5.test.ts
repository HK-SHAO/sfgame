import { expect, test } from 'vitest'
import { LEVEL_5 } from './level-helper'
import { LevelSimulation } from '../src/game/simulation'

const DT = 1 / 60

test('初始状态：画布外高空高速入场，三站待访', () => {
  const sim = new LevelSimulation(LEVEL_5)
  expect(sim.plane.x).toBeLessThan(0)
  expect(sim.plane.vx).toBeGreaterThan(20)
  expect(sim.visitedCount).toBe(0)
  expect(LEVEL_5.goals).toHaveLength(3)
})

test('无操作：可自然到第 2 站，但第二道山脊挡住第 3 站', () => {
  const sim = new LevelSimulation(LEVEL_5)
  for (let t = 0; t < 90; t += DT) sim.step(DT)
  expect(sim.phase).toBe('playing')
  expect(sim.visitedCount).toBeLessThan(3)
  expect(sim.plane.x).toBeLessThan(LEVEL_5.goals[2].x + 5)
}, 30000)

test('站点集合语义：乱序抵达同样计数，三站全部抵达过即过关', () => {
  const sim = new LevelSimulation(LEVEL_5)
  // 先飞入第 3 站圈（最远处）：算抵达过，不因"越序"失效
  sim.plane.x = LEVEL_5.goals[2].x
  sim.plane.y = LEVEL_5.ground(LEVEL_5.goals[2].x) - 5
  sim.plane.vx = 0
  sim.plane.vy = 0
  sim.step(DT)
  expect(sim.phase).toBe('playing')
  expect(sim.visited[2]).toBe(true)
  // 补齐第 1、2 站 → 全部抵达，过关
  sim.plane.x = LEVEL_5.goals[0].x
  sim.plane.y = LEVEL_5.ground(LEVEL_5.goals[0].x) - 5
  sim.step(DT)
  sim.plane.x = LEVEL_5.goals[1].x
  sim.plane.y = LEVEL_5.ground(LEVEL_5.goals[1].x) - 5
  sim.step(DT)
  expect(sim.phase).toBe('won')
  expect(sim.visitedCount).toBe(3)
})

test('预算：热 3 / 冷 2', () => {
  const sim = new LevelSimulation(LEVEL_5)
  expect(sim.hotLeft).toBe(3)
  expect(sim.coldLeft).toBe(2)
})

test('参考答案：双热源接力，约 23.6s 通关（三站全部抵达）', () => {
  const sim = new LevelSimulation(LEVEL_5)
  sim.placeSource(28, 26, 'hot')
  sim.placeSource(48, 19, 'hot')
  let wonAt = -1
  for (let t = 0; t < 45; t += DT) {
    sim.step(DT)
    if (sim.phase === 'won') {
      wonAt = t
      break
    }
  }
  expect(wonAt).toBeGreaterThan(0)
  expect(wonAt).toBeLessThan(35)
  expect(sim.visitedCount).toBe(3)
}, 30000)
