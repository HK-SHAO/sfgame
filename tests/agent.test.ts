import { expect, test } from 'vitest'
import { LEVEL_1 } from '../src/game/levels'
import { LevelSimulation } from '../src/game/simulation'
import { LEVEL_1_REFERENCE, LevelAgent, agentStepsFor } from '../src/game/agent'

const DT = 1 / 60

test('参考答案：4 个热源、时刻递增（像玩家逐个操作）', () => {
  expect(LEVEL_1_REFERENCE.map((s) => s.kind)).toEqual(['hot', 'hot', 'hot', 'hot'])
  expect(LEVEL_1_REFERENCE.length).toBe(4)
  for (let i = 1; i < LEVEL_1_REFERENCE.length; i++) {
    expect(LEVEL_1_REFERENCE[i].t).toBeGreaterThan(LEVEL_1_REFERENCE[i - 1].t)
  }
})

test('agentStepsFor：第一关有方案，未知关卡无方案（Agent 静默）', () => {
  expect(agentStepsFor(LEVEL_1.id)).toBe(LEVEL_1_REFERENCE)
  expect(agentStepsFor(2)).toBeNull()
  expect(agentStepsFor(99)).toBeNull()
})

test('自动播放：agent 驱动下物理自然演化到过关（≤60s）', () => {
  const sim = new LevelSimulation(LEVEL_1)
  const agent = new LevelAgent()
  let wonAt = -1
  for (let t = 0; t < 60; t += DT) {
    agent.step(sim)
    sim.step(DT)
    if (sim.phase === 'won') {
      wonAt = t
      break
    }
  }
  expect(wonAt).toBeGreaterThan(0)
  expect(wonAt).toBeLessThan(60)
  expect(sim.phase).toBe('won')
}, 30000)

test('重置后 agent 重新播放仍可通关', () => {
  const sim = new LevelSimulation(LEVEL_1)
  const agent = new LevelAgent()
  for (let t = 0; t < 5; t += DT) {
    agent.step(sim)
    sim.step(DT)
  }
  sim.reset()
  agent.reset()
  let wonAt = -1
  for (let t = 0; t < 60; t += DT) {
    agent.step(sim)
    sim.step(DT)
    if (sim.phase === 'won') {
      wonAt = t
      break
    }
  }
  expect(wonAt).toBeGreaterThan(0)
  expect(wonAt).toBeLessThan(60)
}, 30000)

test('一致性守卫：玩家介入（如后退撤销）后 agent 停止自动播放', () => {
  const sim = new LevelSimulation(LEVEL_1)
  const agent = new LevelAgent()
  // 播放到第 2 个源已放置
  for (let t = 0; t < 3; t += DT) {
    agent.step(sim)
    sim.step(DT)
  }
  expect(sim.sources.length).toBe(2)
  // 模拟后退撤销：移除最后一个源
  sim.removeSource(sim.sources[1].id)
  expect(sim.sources.length).toBe(1)
  // 之后 agent 永久停止：不再放置任何源
  for (let t = 3; t < 12; t += DT) {
    expect(agent.step(sim)).toBe(false)
    sim.step(DT)
  }
  expect(sim.sources.length).toBe(1)
  expect(sim.phase).toBe('playing')
})
