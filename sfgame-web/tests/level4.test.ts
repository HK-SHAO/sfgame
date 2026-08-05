import { expect, test } from 'vitest'
import { LEVEL_4 } from './level-helper'
import { LevelSimulation } from '../src/game/simulation'

const DT = 1 / 60

test('潮汐风：环境风速随模拟时钟周期性变化', () => {
  const sim = new LevelSimulation(LEVEL_4)
  const air = { x: 0, y: 0 }
  const samples: number[] = []
  for (let t = 0; t < LEVEL_4.ambient!.tide!.period; t += 1) {
    sim.fluid.sampleVelocity(30, 20, air)
    samples.push(air.x)
    for (let k = 0; k < 60; k++) sim.step(DT)
  }
  const span = Math.max(...samples) - Math.min(...samples)
  expect(span).toBeGreaterThan(1) // 风速确实在变化
  // 周期性：半周期后方向应相反（幅值 > 基风）
  expect(samples[Math.floor(samples.length / 2)]).toBeLessThan(samples[0])
}, 30000)

test('无操作：飞机在潮汐中往返，无法翻上孤山', () => {
  const sim = new LevelSimulation(LEVEL_4)
  for (let t = 0; t < 90; t += DT) sim.step(DT)
  expect(sim.phase).toBe('playing')
  expect(sim.visitedCount).toBe(0)
  // 飞机从未越过孤山（x 被挡在迎风面附近）
  expect(sim.plane.x).toBeLessThan(38)
}, 30000)

test('贴地滑进目标圈即过关（虚线圆即抵达范围，滑行与飞行同等计数）', () => {
  const sim = new LevelSimulation(LEVEL_4)
  sim.plane.x = LEVEL_4.goals[0].x
  sim.plane.y = LEVEL_4.ground(LEVEL_4.goals[0].x) - 0.5
  sim.plane.vx = 0
  sim.plane.vy = 0
  sim.step(DT)
  expect(sim.phase).toBe('won')
})

test('参考答案：孤山热源，约 11.5s 通关', () => {
  const sim = new LevelSimulation(LEVEL_4)
  sim.placeSource(32, 44, 'hot')
  let wonAt = -1
  for (let t = 0; t < 30; t += DT) {
    sim.step(DT)
    if (sim.phase === 'won') {
      wonAt = t
      break
    }
  }
  expect(wonAt).toBeGreaterThan(0)
  expect(wonAt).toBeLessThan(20)
}, 30000)
