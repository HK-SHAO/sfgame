import { expect, test } from 'vitest'
import { LEVELS } from '../app/game/levels'
import { LevelSimulation } from '../app/game/simulation'

const LEVEL_5 = LEVELS.find((l) => l.id === 'hui-gui')!
const DT = 1 / 60

test('站点集合语义：乱序抵达同样计数，全部抵达过即过关', () => {
  const sim = new LevelSimulation(LEVEL_5)
  expect(LEVEL_5.goals).toHaveLength(3)
  sim.plane.x = LEVEL_5.goals[2].x
  sim.plane.y = sim.goalGroundY[2] - 5
  sim.step(DT)
  expect(sim.phase).toBe('playing')
  expect(sim.visited[2]).toBe(true)
  sim.plane.x = LEVEL_5.goals[0].x
  sim.plane.y = sim.goalGroundY[0] - 5
  sim.step(DT)
  sim.plane.x = LEVEL_5.goals[1].x
  sim.plane.y = sim.goalGroundY[1] - 5
  sim.step(DT)
  expect(sim.phase).toBe('won')
  expect(sim.visitedCount).toBe(3)
})
