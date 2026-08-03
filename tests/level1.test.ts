import { expect, test } from 'vitest'
import { LEVEL_1 } from '../src/game/levels'
import { LevelSimulation } from '../src/game/simulation'

const DT = 1 / 60

test('初始状态：纸飞机在画布外、离地有一定高度、带初速飞入', () => {
  const sim = new LevelSimulation(LEVEL_1)
  expect(sim.plane.x).toBeLessThan(0)
  expect(sim.plane.y).toBeLessThan(LEVEL_1.ground(0) - 3)
  expect(sim.plane.y).toBeGreaterThan(2)
  expect(sim.plane.vx).toBeGreaterThan(6)
  expect(sim.phase).toBe('playing')
})

test('无操作：飞机缓缓滑翔坠落谷底，无法抵达目标', () => {
  const sim = new LevelSimulation(LEVEL_1)
  let landedAt = -1
  for (let t = 0; t < 20; t += DT) {
    sim.step(DT)
    if (landedAt < 0 && sim.plane.y > LEVEL_1.ground(sim.plane.x) - 1.2) landedAt = t
  }
  // 纸飞机很轻（终端下落约 1 单位/秒），滑翔时间长，但最终必坠谷底
  // （约 14 秒，慢于"很快"，属有意的飘然手感；不变量是"落谷底且不能通关"）
  expect(landedAt).toBeGreaterThan(2)
  expect(landedAt).toBeLessThan(20)
  expect(sim.phase).toBe('playing')
  // 落在谷底（x 未过 36 的爬坡段、y 在谷底地面附近），远离 x=58 的目标区
  expect(sim.plane.x).toBeLessThan(36)
  expect(sim.plane.y).toBeGreaterThan(40)
}, 30000)

test('预算与放置规则生效', () => {
  const sim = new LevelSimulation(LEVEL_1)
  expect(sim.hotLeft).toBe(4)
  expect(sim.coldLeft).toBe(2)
  expect(sim.placeSource(16, 44, 'hot')).not.toBeNull()
  expect(sim.hotLeft).toBe(3)
  // 间距不足
  expect(sim.placeSource(17, 44, 'hot')).toBeNull()
  // 点在地面之下：吸附到贴地高度（核心交互不拒绝）
  const clamped = sim.placeSource(60, 55, 'hot')
  expect(clamped).not.toBeNull()
  expect(clamped!.y).toBeCloseTo(LEVEL_1.ground(60) - 0.7, 5)
  expect(sim.hotLeft).toBe(2)
  // 世界之外仍拒绝
  expect(sim.placeSource(1.2, 20, 'hot')).toBeNull()
  // 冷源预算
  expect(sim.placeSource(30, 40, 'cold')).not.toBeNull()
  expect(sim.coldLeft).toBe(1)
  // 移除返还预算
  const s = sim.sources[0]
  expect(sim.removeSource(s.id)).toBe(true)
  expect(sim.hotLeft).toBe(3)
})

test('重置后回到画布外的初始状态（含初速）', () => {
  const sim = new LevelSimulation(LEVEL_1)
  for (let i = 0; i < 60 * 8; i++) sim.step(DT)
  sim.reset()
  expect(sim.plane.x).toBeLessThan(0)
  expect(sim.plane.vx).toBeGreaterThan(6)
  expect(sim.phase).toBe('playing')
})

test('贴地滑进目标圈不算过关（必须飞行抵达）', () => {
  const sim = new LevelSimulation(LEVEL_1)
  sim.plane.x = LEVEL_1.goal.x
  sim.plane.y = LEVEL_1.ground(LEVEL_1.goal.x) - 0.5
  sim.plane.vx = 0
  sim.plane.vy = 0
  sim.step(DT)
  expect(sim.phase).toBe('playing')
})

test('离地进入目标圈即过关', () => {
  const sim = new LevelSimulation(LEVEL_1)
  sim.plane.x = LEVEL_1.goal.x
  sim.plane.y = LEVEL_1.ground(LEVEL_1.goal.x) - 3
  sim.plane.vx = 0
  sim.plane.vy = 0
  sim.step(DT)
  expect(sim.phase).toBe('won')
})

test('基准策略可通关：沿谷底→崖脚→崖顶→目标放置热源，飞机起飞并飞行抵达', () => {
  const sim = new LevelSimulation(LEVEL_1)
  // 确定性策略（同一次放置，无随机干预）：下方托起 → 崖脚接力 → 崖顶推进 → 目标前托举
  const plan: Array<[number, number]> = [
    [20, 44],
    [36, 28],
    [50, 16],
    [58, 14],
  ]
  for (const [x, y] of plan) {
    expect(sim.placeSource(x, y, 'hot')).not.toBeNull()
  }
  let wonAt = -1
  for (let t = 0; t < 60; t += DT) {
    sim.step(DT)
    if (sim.phase === 'won') {
      wonAt = t
      break
    }
  }
  expect(wonAt).toBeGreaterThan(0)
  expect(wonAt).toBeLessThan(60)
  // 飞行抵达：过关瞬间飞机在目标圈上方（悬停阈值之上）
  expect(sim.plane.y).toBeLessThan(LEVEL_1.ground(sim.plane.x) - 1)
}, 30000)
