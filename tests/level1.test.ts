import { expect, test } from 'vitest'
import { LEVEL_1 } from '../src/game/levels'
import { LevelSimulation } from '../src/game/simulation'

const DT = 1 / 60

test('初始状态：纸飞机静止在谷底', () => {
  const sim = new LevelSimulation(LEVEL_1)
  for (let i = 0; i < 90; i++) sim.step(DT)
  expect(sim.plane.y).toBeGreaterThan(40)
  expect(sim.phase).toBe('playing')
})

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

test('无源时飞机不会凭空起飞', () => {
  const sim = new LevelSimulation(LEVEL_1)
  for (let i = 0; i < 60 * 10; i++) sim.step(DT)
  expect(sim.phase).toBe('playing')
  expect(sim.plane.x).toBeLessThan(30)
})

test('零操作挂机无法通关：崖壁禁止"吸坡瞬移"，飞机被困谷底', () => {
  const sim = new LevelSimulation(LEVEL_1)
  // 覆盖此前 263 秒挂机滑上高崖的漏洞，多留余量
  for (let i = 0; i < 60 * 400; i++) sim.step(DT)
  expect(sim.phase).toBe('playing')
  // 飞机最多滑到缓坡底部（x≈36.7），上不了高原
  expect(sim.plane.x).toBeLessThan(40)
  expect(sim.plane.y).toBeGreaterThan(40)
}, 60000)

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

// 模拟玩家策略：脚下托举 → 接力爬升 → 停止加热，让谷风护送滑翔进场。
const TARGET_Y = 13

function botDecide(sim: LevelSimulation) {
  const px = sim.plane.x
  const py = sim.plane.y
  const gy = LEVEL_1.ground(px)

  // 贴地：清理占位旧源，在脚下放热源托举
  if (py > gy - 2.5) {
    const ty = Math.min(py + 1, gy - 0.7)
    for (const s of [...sim.sources]) {
      if (s.kind === 'hot' && Math.hypot(s.x - px, s.y - ty) < 3.2) sim.removeSource(s.id)
    }
    if (sim.hotLeft > 0 && sim.canPlaceAt(px, ty)) sim.placeSource(px, ty, 'hot')
    return
  }

  // 未到巡航高度：在飞机下方补热源继续爬升（预算不足时回收远源）
  if (py > TARGET_Y) {
    if (sim.hotLeft === 0) {
      let farthest: { id: number; d: number } | null = null
      for (const s of sim.sources) {
        if (s.kind !== 'hot') continue
        const d = Math.hypot(s.x - px, s.y - py)
        if (d > 8 && (!farthest || d > farthest.d)) farthest = { id: s.id, d }
      }
      if (farthest) sim.removeSource(farthest.id)
    }
    const candidates = [
      { x: px, y: py + 3.5 },
      { x: px - 2, y: py + 3 },
      { x: px + 2, y: py + 3 },
    ]
    for (const c of candidates) {
      if (sim.hotLeft > 0 && sim.canPlaceAt(c.x, c.y)) {
        sim.placeSource(c.x, c.y, 'hot')
        return
      }
    }
    return
  }

  // 巡航高度：停止托举，让谷风护送右行、自然下沉进场；过高用冷源轻压
  const goalCX = LEVEL_1.goal.x
  const goalCY = LEVEL_1.ground(goalCX) - 2
  if (py < goalCY - LEVEL_1.goal.r + 1 && px > goalCX - 16) {
    if (sim.coldLeft > 0 && sim.canPlaceAt(px, py - 3)) sim.placeSource(px, py - 3, 'cold')
  }
}

test('第 1 关可通关：托举-爬升-滑翔（模拟玩家策略）', () => {
  const sim = new LevelSimulation(LEVEL_1)
  // 起手：纸飞机脚下放热源（贴地托举）
  expect(sim.placeSource(16, LEVEL_1.ground(16) - 0.7, 'hot')).not.toBeNull()

  let nextDecision = 1.5
  const maxSeconds = 90
  for (let t = 0; t < maxSeconds; t += DT) {
    sim.step(DT)
    if (sim.phase === 'won') break
    if (t >= nextDecision) {
      nextDecision = t + 1.5
      botDecide(sim)
    }
  }

  expect(sim.phase).toBe('won')
}, 30000)
