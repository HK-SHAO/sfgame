import { expect, test } from 'vitest'
import { LEVEL_1 } from '../src/game/levels'
import { LEVEL_3 } from './level-helper'
import { LevelSimulation } from '../src/game/simulation'

const DT = 1 / 60

test('暂停（dev 空格）：时间、飞机位置与站点判定全部冻结，恢复后继续', () => {
  const sim = new LevelSimulation(LEVEL_1)
  sim.placeSource(20, 44, 'hot')
  for (let i = 0; i < 60 * 2; i++) sim.step(DT) // 预热 2 秒，飞机离开出生点
  const t = sim.time
  const x = sim.plane.x
  const y = sim.plane.y
  sim.setPaused(true)
  for (let i = 0; i < 60 * 3; i++) sim.step(DT)
  expect(sim.time).toBe(t)
  expect(sim.plane.x).toBe(x)
  expect(sim.plane.y).toBe(y)
  expect(sim.phase).toBe('playing')
  // 恢复：物理继续推进
  sim.setPaused(false)
  sim.step(DT)
  expect(sim.time).toBeGreaterThan(t)
  expect(sim.plane.x).not.toBe(x)
}, 30000)

test('暂停中即使飞机已在目标圈内也不判定过关', () => {
  const sim = new LevelSimulation(LEVEL_1)
  sim.plane.x = LEVEL_1.goals[0].x
  sim.plane.y = LEVEL_1.ground(LEVEL_1.goals[0].x) - 3
  sim.setPaused(true)
  sim.step(DT)
  expect(sim.phase).toBe('playing')
  expect(sim.visitedCount).toBe(0)
  // 恢复后的第一步即判定过关
  sim.setPaused(false)
  sim.step(DT)
  expect(sim.phase).toBe('won')
})

test('过关瞬间冻结：结算弹窗出现后物理不再运行（纸飞机不被风吹走）', () => {
  const sim = new LevelSimulation(LEVEL_1)
  sim.plane.x = LEVEL_1.goals[0].x
  sim.plane.y = LEVEL_1.ground(LEVEL_1.goals[0].x) - 3
  sim.step(DT)
  expect(sim.phase).toBe('won')
  const t = sim.time
  const x = sim.plane.x
  const y = sim.plane.y
  for (let i = 0; i < 60 * 5; i++) sim.step(DT)
  expect(sim.phase).toBe('won')
  expect(sim.time).toBe(t) // 计时冻结在通关时刻
  expect(sim.plane.x).toBe(x)
  expect(sim.plane.y).toBe(y)
}, 30000)

test('restart 解除暂停与过关冻结，站点复位待访', () => {
  const sim = new LevelSimulation(LEVEL_3)
  sim.plane.x = LEVEL_3.goals[0].x
  sim.plane.y = LEVEL_3.ground(LEVEL_3.goals[0].x) - 5
  sim.step(DT)
  expect(sim.visited[0]).toBe(true)
  sim.setPaused(true)
  sim.restart()
  expect(sim.paused).toBe(false)
  expect(sim.phase).toBe('playing')
  expect(sim.visited.every((v) => !v)).toBe(true)
  expect(sim.visitedCount).toBe(0)
})
