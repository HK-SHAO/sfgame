import { expect, test } from 'vitest'
import { levelFromJson } from '../app/game/level-format'
import { fanDirection, LevelSimulation } from '../app/game/simulation'
import type { LevelJson } from '../app/game/types'

// 空关卡骨架：无 fixed/fans，测试各自补齐
const BASE: LevelJson = {
  schema: 1,
  id: 99,
  group: '测试',
  name: 't',
  tagline: 't',
  win: { title: 't', text: 't' },
  world: { w: 76, h: 56, cell: 0.75 },
  ground: { expr: '50' },
  budget: { hot: 2, cold: 2 },
  spawn: { x: -5, y: 10, vx: 0 },
  goals: [{ x: 40, r: 10 }],
}

test('固定源：持续加热流体、玩家不可移除、不占预算', () => {
  const sim = new LevelSimulation(
    levelFromJson({ ...BASE, fixed: [{ x: 30, y: 20, kind: 'hot' }] }),
  )
  for (let t = 0; t < 60; t++) sim.step(1 / 60)
  expect(sim.fluid.sampleTemp(30, 20)).toBeGreaterThan(1)
  // 独立数组：hitSource 命中不了、removeSource 删不掉、预算不受影响
  expect(sim.hitSource(30, 20)).toBeNull()
  expect(sim.fixedSources.length).toBe(1)
  expect(sim.hotLeft).toBe(2)
})

test('风扇：定向注入产生下风方向气流', () => {
  const sim = new LevelSimulation(
    levelFromJson({ ...BASE, fans: [{ x: 20, y: 10, dir: 0, power: 3 }] }),
  )
  const out = { x: 0, y: 0 }
  // 射流需数秒建立（动量累积 + 投影塑造），4s 后下风 4 单位处已达 >1
  for (let t = 0; t < 240; t++) sim.step(1 / 60)
  sim.fluid.sampleVelocity(24, 10, out)
  expect(out.x).toBeGreaterThan(1)
})

test('摇头风扇：朝向按周期正弦摆动（纯函数）', () => {
  const fan = { x: 0, y: 0, dir: 0, power: 1, swing: 0.5, period: 2 }
  expect(fanDirection(fan, 0)).toBeCloseTo(0, 10)
  expect(fanDirection(fan, 0.5)).toBeCloseTo(0.5, 10)
  expect(fanDirection(fan, 1.5)).toBeCloseTo(-0.5, 10)
  expect(fanDirection({ x: 0, y: 0, dir: 0.3, power: 1 }, 5)).toBe(0.3)
})
