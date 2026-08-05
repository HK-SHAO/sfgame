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

test('重置后回到画布外的初始状态（含初速），源与预算清空', () => {
  const sim = new LevelSimulation(LEVEL_1)
  expect(sim.placeSource(20, 44, 'hot')).not.toBeNull()
  for (let i = 0; i < 60 * 8; i++) sim.step(DT)
  sim.reset()
  expect(sim.plane.x).toBeLessThan(0)
  expect(sim.plane.vx).toBeGreaterThan(6)
  expect(sim.phase).toBe('playing')
  expect(sim.sources).toHaveLength(0)
  expect(sim.hotLeft).toBe(4)
})

test('restart 保留玩家已放置的源与预算，仅清场与复位飞机（微调实验）', () => {
  const sim = new LevelSimulation(LEVEL_1)
  expect(sim.placeSource(20, 44, 'hot')).not.toBeNull()
  expect(sim.placeSource(36, 28, 'hot')).not.toBeNull()
  const sourcesBefore = sim.sources.map((s) => ({ id: s.id, x: s.x, y: s.y, kind: s.kind }))
  for (let i = 0; i < 60 * 2; i++) sim.step(DT)
  // 2 秒加热后温度场应有非零值（源附近）
  expect(sim.fluid.t.some((v) => v !== 0)).toBe(true)
  sim.restart()
  // 源原样保留（含 id），预算不返还
  expect(sim.sources).toHaveLength(2)
  expect(sim.sources.map((s) => ({ id: s.id, x: s.x, y: s.y, kind: s.kind }))).toEqual(sourcesBefore)
  expect(sim.hotLeft).toBe(2)
  // born 归零：time < born 会让渲染 pop 为负、源隐形（回归守护）
  expect(sim.sources.every((s) => s.born === 0)).toBe(true)
  expect(sim.fluid.t.every((v) => v === 0)).toBe(true)
  expect(sim.plane.x).toBeLessThan(0)
  expect(sim.plane.vx).toBeGreaterThan(6)
  expect(sim.time).toBe(0)
  expect(sim.phase).toBe('playing')
}, 10000)

test('贴地滑进目标圈不算过关（必须飞行抵达）', () => {
  const sim = new LevelSimulation(LEVEL_1)
  sim.plane.x = LEVEL_1.goals[0].x
  sim.plane.y = LEVEL_1.ground(LEVEL_1.goals[0].x) - 0.5
  sim.plane.vx = 0
  sim.plane.vy = 0
  sim.step(DT)
  expect(sim.phase).toBe('playing')
})

test('离地进入目标圈即过关', () => {
  const sim = new LevelSimulation(LEVEL_1)
  sim.plane.x = LEVEL_1.goals[0].x
  sim.plane.y = LEVEL_1.ground(LEVEL_1.goals[0].x) - 3
  sim.plane.vx = 0
  sim.plane.vy = 0
  sim.step(DT)
  expect(sim.phase).toBe('won')
})

test('获胜后：普通放置被拒，force 恢复放置可用（URL 状态"重做"路径）', () => {
  const sim = new LevelSimulation(LEVEL_1)
  sim.plane.x = LEVEL_1.goals[0].x
  sim.plane.y = LEVEL_1.ground(LEVEL_1.goals[0].x) - 3
  sim.step(DT)
  expect(sim.phase).toBe('won')
  // 玩家操作：获胜后不可再放置
  expect(sim.placeSource(20, 44, 'hot')).toBeNull()
  // URL 状态恢复：force 可放回（预算/间距校验仍生效）
  const spots: Array<[number, number]> = [
    [20, 44],
    [30, 40],
    [40, 32],
    [50, 24],
    [60, 16],
  ]
  for (const [x, y] of spots) {
    const placed = sim.placeSource(x, y, 'hot', true)
    if (x === 60) expect(placed).toBeNull() // 第 5 个：热源预算 4 已耗尽
    else expect(placed).not.toBeNull()
  }
  expect(sim.hotLeft).toBe(0)
  // applySources 走同一 force 机制（URL 重做路径）
  sim.applySources([{ x: 20, y: 44, kind: 'hot' }])
  expect(sim.sources.length).toBe(1)
})

test('applySources 差异应用：撤销/重做/替换均正确，存活源保留 born', () => {
  const sim = new LevelSimulation(LEVEL_1)
  const a = sim.placeSource(20, 44, 'hot')!
  for (let k = 0; k < 60; k++) sim.step(DT) // 让 A 变老
  const bornA = a.born
  const b = sim.placeSource(36, 28, 'hot')!
  expect(sim.sources.length).toBe(2)

  // 后退撤销 B：场上剩 A，A 原样保留（id/born 不变，不重播生长动画）
  sim.applySources([{ x: 20, y: 44, kind: 'hot' }])
  expect(sim.sources.length).toBe(1)
  expect(sim.sources[0].id).toBe(a.id)
  expect(sim.sources[0].born).toBe(bornA)
  expect(sim.sources.some((s) => s.id === b.id)).toBe(false)

  // 前进重做：恢复 B
  sim.applySources([
    { x: 20, y: 44, kind: 'hot' },
    { x: 36, y: 28, kind: 'hot' },
  ])
  expect(sim.sources.length).toBe(2)
  expect(sim.sources[0].id).toBe(a.id) // 存活源仍未被重放

  // 替换：C(50,16) 换掉 B(36,28)
  sim.applySources([
    { x: 20, y: 44, kind: 'hot' },
    { x: 50, y: 16, kind: 'hot' },
  ])
  expect(sim.sources.length).toBe(2)
  expect(sim.sources.some((s) => s.x === 50)).toBe(true)
  expect(sim.sources.some((s) => s.x === 36)).toBe(false)

  // 清空：目标为空 → 全部移除
  sim.applySources([])
  expect(sim.sources.length).toBe(0)
  expect(sim.hotLeft).toBe(4)
})

test('基准策略可通关：沿谷底→崖脚→崖顶→目标放置热源，飞机起飞并飞行抵达', () => {
  const sim = new LevelSimulation(LEVEL_1)
  // 确定性策略（同一次放置，无随机干预）：下方托起 → 崖脚接力 → 崖顶推进 → 目标前托举
  // （贴地物理：飞机落地后需源贴近才可撬起，故接力源沿飞机航线密排，保持全程飞行）
  const plan: Array<[number, number]> = [
    [20, 44],
    [38, 28],
    [48, 14],
    [54, 12],
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

test('计时与惩罚性耗时：按场上源数计费，移除减免，restart 保留，won 冻结', () => {
  const sim = new LevelSimulation(LEVEL_1)
  // 初始：无源无惩罚，计时从 0 起
  let hud = sim.hudState()
  expect(hud.time).toBe(0)
  expect(hud.extra).toBe(0)
  expect(hud.sources).toBe(0)
  // 放 3 源（基准解规模）→ 惩罚 = 3 × 4s = 12s；计时随模拟推进
  sim.placeSource(20, 44, 'hot')
  sim.placeSource(38, 28, 'hot')
  sim.placeSource(48, 14, 'hot')
  for (let i = 0; i < 60; i++) sim.step(DT)
  hud = sim.hudState()
  expect(hud.time).toBeCloseTo(1, 5)
  expect(hud.extra).toBe(12)
  expect(hud.sources).toBe(3)
  // 移除一个源 → 惩罚按当前场上数减免
  const removed = sim.sources.find((s) => s.x === 48)!
  sim.removeSource(removed.id)
  expect(sim.hudState().extra).toBe(8)
  // restart（再玩一次）：保留源 → 惩罚保留；计时归零重新计
  sim.restart()
  hud = sim.hudState()
  expect(hud.time).toBe(0)
  expect(hud.extra).toBe(8)
  // 补齐基准解（[20,44][38,28][48,14][54,12]）→ 通关；won 后计时冻结
  sim.placeSource(48, 14, 'hot')
  sim.placeSource(54, 12, 'hot')
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
  expect(sim.hudState().time).toBe(frozen) // 冻结
  expect(sim.phase).toBe('won')
}, 30000)
