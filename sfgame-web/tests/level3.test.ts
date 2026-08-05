import { expect, test } from 'vitest'
import { LEVEL_3 } from './level-helper'
import { LevelSimulation } from '../src/game/simulation'

const DT = 1 / 60

test('初始状态：画布外高空高速入场', () => {
  const sim = new LevelSimulation(LEVEL_3)
  expect(sim.plane.x).toBeLessThan(0)
  expect(sim.plane.vx).toBeGreaterThan(20)
  expect(sim.plane.y).toBeLessThan(LEVEL_3.ground(0) - 8)
  expect(sim.visitedCount).toBe(0)
})

test('无操作：自然抵达第 1 站，被山脊挡在第 2 站外', () => {
  const sim = new LevelSimulation(LEVEL_3)
  for (let t = 0; t < 60; t += DT) {
    sim.step(DT)
  }
  expect(sim.phase).toBe('playing')
  // 第 1 站（平原）自然抵达；第 2 站（高原）必须热源托升
  expect(sim.visited[0]).toBe(true)
  expect(sim.visited[1]).toBe(false)
  expect(sim.plane.x).toBeLessThan(LEVEL_3.goals[1].x + 8)
}, 30000)

test('站点集合语义：抵达顺序无关，全部抵达过即过关', () => {
  const sim = new LevelSimulation(LEVEL_3)
  // 先直接飞入第 2 站圈：同样算"抵达过"（不要求先到第 1 站）
  sim.plane.x = LEVEL_3.goals[1].x
  sim.plane.y = LEVEL_3.ground(LEVEL_3.goals[1].x) - 5
  sim.plane.vx = 0
  sim.plane.vy = 0
  sim.step(DT)
  expect(sim.phase).toBe('playing')
  expect(sim.visited[1]).toBe(true)
  expect(sim.visitedCount).toBe(1)
  // 再飞入第 1 站圈：两站全部抵达 → 过关
  sim.plane.x = LEVEL_3.goals[0].x
  sim.plane.y = LEVEL_3.ground(LEVEL_3.goals[0].x) - 5
  sim.step(DT)
  expect(sim.phase).toBe('won')
  expect(sim.visitedCount).toBe(2)
})

test('预算与放置规则生效', () => {
  const sim = new LevelSimulation(LEVEL_3)
  expect(sim.hotLeft).toBe(3)
  expect(sim.coldLeft).toBe(2)
  expect(sim.placeSource(20, 28, 'hot')).not.toBeNull()
  expect(sim.hotLeft).toBe(2)
  expect(sim.placeSource(21, 29, 'hot')).toBeNull() // 间距不足
  expect(sim.placeSource(1.2, 20, 'hot')).toBeNull() // 世界之外
})

test('参考答案：单热源翻山脊，约 8.8s 通关（两站全部抵达）', () => {
  const sim = new LevelSimulation(LEVEL_3)
  sim.placeSource(26, 28, 'hot')
  let wonAt = -1
  for (let t = 0; t < 30; t += DT) {
    sim.step(DT)
    if (sim.phase === 'won') {
      wonAt = t
      break
    }
  }
  expect(wonAt).toBeGreaterThan(0)
  expect(wonAt).toBeLessThan(15)
  expect(sim.visitedCount).toBe(2)
}, 30000)
