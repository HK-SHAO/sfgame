import { expect, test } from 'vitest'
import { LEVELS_BY_ID } from '../app/game/levels'
import { LevelSimulation } from '../app/game/simulation'

const LEVEL_1 = LEVELS_BY_ID.get(1)!
const DT = 1 / 60

test('暂停冻结时间、位置与判定，恢复后继续', () => {
  const sim = new LevelSimulation(LEVEL_1)
  sim.placeSource(20, 44, 'hot')
  for (let i = 0; i < 60 * 2; i++) sim.step(DT)
  const t = sim.time
  const x = sim.plane.x
  sim.setPaused(true)
  for (let i = 0; i < 60 * 3; i++) sim.step(DT)
  expect(sim.time).toBe(t)
  expect(sim.plane.x).toBe(x)
  expect(sim.phase).toBe('playing')
  sim.setPaused(false)
  sim.step(DT)
  expect(sim.time).toBeGreaterThan(t)
  expect(sim.plane.x).not.toBe(x)
})

test('过关即冻结：物理与计时停在通关时刻', () => {
  const sim = new LevelSimulation(LEVEL_1)
  sim.plane.x = LEVEL_1.goals[0].x
  sim.plane.y = LEVEL_1.ground(LEVEL_1.goals[0].x) - 3
  sim.step(DT)
  expect(sim.phase).toBe('won')
  const t = sim.time
  const x = sim.plane.x
  for (let i = 0; i < 60 * 5; i++) sim.step(DT)
  expect(sim.phase).toBe('won')
  expect(sim.time).toBe(t)
  expect(sim.plane.x).toBe(x)
})
