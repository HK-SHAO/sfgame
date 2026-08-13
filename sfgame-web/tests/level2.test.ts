import { expect, test } from 'vitest'
import { LEVELS_BY_ID } from '../app/game/levels.ts'
import { levelFromJson, parseLevelText } from '../app/game/level-format.ts'
import { LevelSimulation } from '../app/game/simulation.ts'
import { WasmFluid } from '../app/sim/fluid.ts'
import { surfaceY } from '../app/sim/terrain.ts'

const LEVEL_2 = LEVELS_BY_ID.get('fu-yao')!

const DT = 1 / 60

test('初始状态：纸飞机在画布外、离地有一定高度、带初速飞入', () => {
  const sim = new LevelSimulation(LEVEL_2)
  expect(sim.plane.x).toBeLessThan(0)
  expect(sim.plane.y).toBeLessThan(surfaceY(sim.terrain, 0, LEVEL_2.world.h) - 3)
  expect(sim.plane.y).toBeGreaterThan(2)
  expect(sim.plane.vx).toBeGreaterThan(6)
  expect(sim.phase).toBe('playing')
})

test('预算与放置规则：预算扣减/返还、间距、世界外拒绝、贴地吸附', () => {
  const sim = new LevelSimulation(LEVEL_2)
  expect(sim.hotLeft).toBe(4)
  expect(sim.coldLeft).toBe(2)
  expect(sim.placeSource(16, 44, 'hot')).not.toBeNull()
  expect(sim.hotLeft).toBe(3)
  expect(sim.placeSource(17, 44, 'hot')).toBeNull()
  const clamped = sim.placeSource(60, 55, 'hot')
  expect(clamped).not.toBeNull()
  expect(clamped!.y).toBeCloseTo(surfaceY(sim.terrain, 60, LEVEL_2.world.h) - 0.7, 5)
  // 边界死区对齐 toWorld ±0.5：仅世界外拒绝
  expect(sim.placeSource(0.4, 20, 'hot')).toBeNull()
  expect(sim.placeSource(1.2, 20, 'hot')).not.toBeNull()
  expect(sim.placeSource(LEVEL_2.world.w - 0.4, 20, 'hot')).toBeNull()
  expect(sim.placeSource(30, 40, 'cold')).not.toBeNull()
  expect(sim.coldLeft).toBe(1)
  const s = sim.sources[0]
  expect(sim.removeSource(s.id)).toBe(true)
  expect(sim.hotLeft).toBe(2)
})

test('restart 保留玩家已放置的源与预算，仅清场复位飞机', () => {
  const sim = new LevelSimulation(LEVEL_2)
  expect(sim.placeSource(20, 44, 'hot')).not.toBeNull()
  expect(sim.placeSource(36, 28, 'hot')).not.toBeNull()
  const sourcesBefore = sim.sources.map((s) => ({ id: s.id, x: s.x, y: s.y, kind: s.kind }))
  for (let i = 0; i < 60 * 2; i++) sim.step(DT)
  sim.restart()
  expect(sim.sources.map((s) => ({ id: s.id, x: s.x, y: s.y, kind: s.kind }))).toEqual(sourcesBefore)
  expect(sim.hotLeft).toBe(2)
  // born 归零：否则新一局 time < born，渲染 pop 为负源隐形
  expect(sim.sources.every((s) => s.born === 0)).toBe(true)
  // 清场语义：直读内核温度场验证全零
  expect((sim.fluid as WasmFluid).fieldViews().t.every((v) => v === 0)).toBe(true)
  expect(sim.plane.x).toBeLessThan(0)
  expect(sim.time).toBe(0)
  expect(sim.phase).toBe('playing')
})

test('抵达语义：贴地滑入与飞入目标圈同等计数', () => {
  const slide = new LevelSimulation(LEVEL_2)
  slide.plane.x = LEVEL_2.goals[0].x
  slide.plane.y = slide.goalAnchorY[0] - 0.5
  slide.step(DT)
  expect(slide.phase).toBe('won')

  const fly = new LevelSimulation(LEVEL_2)
  fly.plane.x = LEVEL_2.goals[0].x
  fly.plane.y = fly.goalAnchorY[0] - 3
  fly.step(DT)
  expect(fly.phase).toBe('won')
})

// 显式 y 锚点：洞穴内旗子落点可精确指定，不被地表高度推导覆盖

test('目标锚点：显式 y 覆盖地表推导（洞穴内放置）', () => {
  const level = levelFromJson(
    parseLevelText(JSON.stringify({
      id: 'cave-goal',
      name: '穴',
      tagline: '测',
      win: { title: '测', text: '测' },
      world: { w: 64, h: 56, cell: 0.75 },
      terrain: { sdf: 'smax(flat(40), -circle(30, 20, 8), 3)' },
      budget: { hot: 1, cold: 1 },
      spawn: { x: -5, y: 8, vx: 16 },
      goals: [{ x: 30, y: 20, r: 3 }],
    })),
  )
  const sim = new LevelSimulation(level)
  // 地表在 x=30 处约 40，洞穴在 y≈20——显式 y 应把锚点定在洞穴内
  expect(sim.goalAnchorY[0]).toBe(20)
  expect(sim.goalAnchorY[0]).toBeLessThan(surfaceY(sim.terrain, 30, level.world.h))
  // 飞机入洞抵达检测圈（锚点上方 GOAL_LIFT 处）即过关
  sim.plane.x = 30
  sim.plane.y = 18
  sim.step(DT)
  expect(sim.phase).toBe('won')
})

test('applySources 差异应用：撤销/重做/替换/清空，存活源保留 id 与 born', () => {
  const sim = new LevelSimulation(LEVEL_2)
  const a = sim.placeSource(20, 44, 'hot')!
  for (let k = 0; k < 60; k++) sim.step(DT)
  const bornA = a.born
  const b = sim.placeSource(36, 28, 'hot')!
  expect(sim.sources.length).toBe(2)

  sim.applySources([{ x: 20, y: 44, kind: 'hot' }])
  expect(sim.sources.length).toBe(1)
  expect(sim.sources[0].id).toBe(a.id)
  expect(sim.sources[0].born).toBe(bornA)
  expect(sim.sources.some((s) => s.id === b.id)).toBe(false)

  sim.applySources([
    { x: 20, y: 44, kind: 'hot' },
    { x: 36, y: 28, kind: 'hot' },
  ])
  expect(sim.sources.length).toBe(2)
  expect(sim.sources[0].id).toBe(a.id)

  sim.applySources([
    { x: 20, y: 44, kind: 'hot' },
    { x: 50, y: 16, kind: 'hot' },
  ])
  expect(sim.sources.length).toBe(2)
  expect(sim.sources.some((s) => s.x === 50)).toBe(true)
  expect(sim.sources.some((s) => s.x === 36)).toBe(false)

  sim.applySources([])
  expect(sim.sources.length).toBe(0)
  expect(sim.hotLeft).toBe(4)
})

test('计时与罚时：按场上源数计费、移除减免、restart 保留、won 冻结', () => {
  const sim = new LevelSimulation(LEVEL_2)
  let hud = sim.hudState()
  expect(hud.time).toBe(0)
  expect(hud.extra).toBe(0)
  // 已知解摆法（同 verify-known 回归）+ 一个额外源计罚：通关路径在新物理下稳定
  sim.placeSource(62, 20.3, 'hot')
  sim.placeSource(38, 30.1, 'cold')
  sim.placeSource(8, 45.6, 'hot')
  for (let i = 0; i < 60; i++) sim.step(DT)
  hud = sim.hudState()
  expect(hud.time).toBeCloseTo(1, 5)
  expect(hud.extra).toBe(12)
  expect(hud.sources).toBe(3)
  const removed = sim.sources.find((s) => s.x === 8)!
  sim.removeSource(removed.id)
  expect(sim.hudState().extra).toBe(8)
  sim.restart()
  hud = sim.hudState()
  expect(hud.time).toBe(0)
  expect(hud.extra).toBe(8)
  let wonAt = -1
  for (let t = 0; t < 60; t += DT) {
    sim.step(DT)
    if (sim.phase === 'won') {
      wonAt = t
      break
    }
  }
  expect(wonAt).toBeGreaterThan(0)
  const frozen = sim.hudState().time
  for (let i = 0; i < 60; i++) sim.step(DT)
  expect(sim.hudState().time).toBe(frozen)
}, 30000)
