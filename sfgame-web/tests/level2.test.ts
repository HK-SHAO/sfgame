import { expect, test } from 'vitest'
import { LEVEL_2 } from '../src/game/levels'
import { LevelSimulation } from '../src/game/simulation'

const DT = 1 / 60

test('初始状态：飞机在画布外高空、带初速飞入', () => {
  const sim = new LevelSimulation(LEVEL_2)
  expect(sim.plane.x).toBeLessThan(0)
  expect(sim.plane.y).toBeLessThan(LEVEL_2.ground(0) - 20)
  expect(sim.plane.y).toBeGreaterThan(2)
  expect(sim.plane.vx).toBeGreaterThan(6)
  expect(sim.phase).toBe('playing')
})

test('无操作：飞机掠过目标上空、撞上右侧谷壁，无法通关', () => {
  const sim = new LevelSimulation(LEVEL_2)
  // 记录掠过目标横坐标时的高度：必须从目标圈上方越过（越位失败）
  let yAtGoalX: number | null = null
  let prevX = sim.plane.x
  for (let t = 0; t < 45; t += DT) {
    sim.step(DT)
    const p = sim.plane
    if (yAtGoalX === null && prevX < LEVEL_2.goals[0].x && p.x >= LEVEL_2.goals[0].x) {
      yAtGoalX = p.y
    }
    prevX = p.x
  }
  expect(sim.phase).toBe('playing')
  // 越过目标横坐标时远在感应圈顶之上（圈顶 = ground - 2 - r）
  const circleTop = LEVEL_2.ground(LEVEL_2.goals[0].x) - 2 - LEVEL_2.goals[0].r
  expect(yAtGoalX).not.toBeNull()
  expect(yAtGoalX!).toBeLessThan(circleTop - 3)
  // 最终贴在右侧谷壁附近
  expect(sim.plane.x).toBeGreaterThan(70)
}, 30000)

test('预算与放置规则生效（冷源为主的关卡）', () => {
  const sim = new LevelSimulation(LEVEL_2)
  expect(sim.hotLeft).toBe(2)
  expect(sim.coldLeft).toBe(3)
  expect(sim.placeSource(50, 24, 'cold')).not.toBeNull()
  expect(sim.coldLeft).toBe(2)
  // 间距不足
  expect(sim.placeSource(51, 25, 'cold')).toBeNull()
  // 世界之外拒绝
  expect(sim.placeSource(1.2, 20, 'cold')).toBeNull()
  // 热源预算
  expect(sim.placeSource(30, 30, 'hot')).not.toBeNull()
  expect(sim.hotLeft).toBe(1)
  // 移除返还预算
  const s = sim.sources[0]
  expect(sim.removeSource(s.id)).toBe(true)
  expect(sim.coldLeft).toBe(3)
})

test('重置后回到画布外的初始状态（含初速）', () => {
  const sim = new LevelSimulation(LEVEL_2)
  for (let i = 0; i < 60 * 8; i++) sim.step(DT)
  sim.reset()
  expect(sim.plane.x).toBeLessThan(0)
  expect(sim.plane.y).toBeLessThan(12)
  expect(sim.plane.vx).toBeGreaterThan(6)
  expect(sim.phase).toBe('playing')
})

test('贴地滑进目标圈不算过关（必须飞行抵达）', () => {
  const sim = new LevelSimulation(LEVEL_2)
  sim.plane.x = LEVEL_2.goals[0].x
  sim.plane.y = LEVEL_2.ground(LEVEL_2.goals[0].x) - 0.5
  sim.plane.vx = 0
  sim.plane.vy = 0
  sim.step(DT)
  expect(sim.phase).toBe('playing')
})

test('地形：谷地左浅右深，目标位于更深处', () => {
  expect(LEVEL_2.ground(70)).toBeGreaterThan(LEVEL_2.ground(5) + 4)
  // 目标圈中心比入场高度低得多（这是一次"降落"）
  const goalCenterY = LEVEL_2.ground(LEVEL_2.goals[0].x) - 2
  expect(goalCenterY).toBeGreaterThan(LEVEL_2.spawn.y! + 20)
})
