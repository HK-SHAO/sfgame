import { expect, test } from 'vitest'
import { LEVELS } from '../app/game/levels'
import { LevelSimulation } from '../app/game/simulation'

const LEVEL_4 = LEVELS.find((l) => l.id === 'chao-xi')!
const DT = 1 / 60

test('潮汐风：环境风速随模拟时钟周期性变化，半周期后反向', () => {
  const sim = new LevelSimulation(LEVEL_4)
  const air = { x: 0, y: 0 }
  const samples: number[] = []
  for (let t = 0; t < LEVEL_4.ambient!.tide!.period; t += 1) {
    sim.fluid.sampleVelocity(30, 20, air)
    samples.push(air.x)
    for (let k = 0; k < 60; k++) sim.step(DT)
  }
  const span = Math.max(...samples) - Math.min(...samples)
  expect(span).toBeGreaterThan(1)
  expect(samples[Math.floor(samples.length / 2)]).toBeLessThan(samples[0])
}, 30000)
