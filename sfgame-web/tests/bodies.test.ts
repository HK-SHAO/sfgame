import { expect, test } from 'vitest'
import { createBody, stepBody } from '../app/sim/bodies.ts'
import { createFluid } from '../app/sim/fluid.ts'
import type { TerrainLike } from '../app/sim/terrain.ts'

// 解析式地形桩（平面 y=y0，法向朝天）：免烘焙场，逐位精确
const flat = (y0: number): TerrainLike => ({
  sample: (_x, y) => y0 - y,
  normal: (_x, _y, out) => {
    out.x = 0
    out.y = -1
  },
})

function makeCalmFluid() {
  return createFluid({
    nx: 8,
    ny: 8,
    cell: 10,
    buoyancy: 0,
    tMax: 9,
    sourceRadius: 1,
    velDamping: 1,
    tDamping: 1,
    iterations: 2,
    margin: 0,
  })
}

const DT = 1 / 60

// 无墙：飞机可飞出地图，地面是唯一边界
test('飞出地图：不受边界拦截，延展地面仍接住它', () => {
  const fluid = makeCalmFluid()
  const body = createBody(74, 39)
  body.vx = 20
  const ground = flat(40)
  for (let i = 0; i < 120; i++) stepBody(body, fluid, DT, ground)
  expect(body.x).toBeGreaterThan(76) // 已越过地图右缘
  expect(body.y).toBe(40) // 延展地面接住，不穿地
})

// 悬停阈值 HOVER_WIND = 1.0：上升风超过它才抬升，不足则继续下落
test('垂直风：超过悬停阈值抬升、不足则下落', () => {
  const ground = flat(100) // 地面足够深，只观察空气行为
  const up = makeCalmFluid()
  up.setAmbient(0, -2)
  const rising = createBody(30, 50)
  for (let i = 0; i < 120; i++) stepBody(rising, up, DT, ground)
  expect(rising.y).toBeLessThan(50)

  const weak = makeCalmFluid()
  weak.setAmbient(0, -0.5)
  const sinking = createBody(30, 50)
  for (let i = 0; i < 120; i++) stepBody(sinking, weak, DT, ground)
  expect(sinking.y).toBeGreaterThan(50)
})

// 地面：静息恰在地面上（不穿地），静风下惯性最终耗散停住
test('静风落地：质点静息在地面上且最终停住', () => {
  const fluid = makeCalmFluid()
  const ground = flat(40)
  const body = createBody(30, 36)
  body.vx = 4
  for (let i = 0; i < 600; i++) stepBody(body, fluid, DT, ground)
  expect(body.y).toBe(40)
  expect(body.vx).toBe(0)
})

// 空气耦合：水平风持续推动贴地质点（风强度决定一切，无上坡代价/墙概念）
test('水平风推动贴地质点', () => {
  const fluid = makeCalmFluid()
  fluid.setAmbient(2, 0)
  const ground = flat(40)
  const body = createBody(30, 40)
  for (let i = 0; i < 240; i++) stepBody(body, fluid, DT, ground)
  expect(body.x).toBeGreaterThan(33)
  expect(body.y).toBe(40)
})

// 机头稳稳指向运动方向（drag 使速度收敛于风，故即风向）
test('机头朝向：顺风向右飞则朝右、向左飞则朝左', () => {
  const ground = flat(100)
  const right = makeCalmFluid()
  right.setAmbient(6, 0)
  const r = createBody(20, 30)
  for (let i = 0; i < 120; i++) stepBody(r, right, DT, ground)
  expect(Math.cos(r.angle)).toBeGreaterThan(0.9)

  const left = makeCalmFluid()
  left.setAmbient(-6, 0)
  const l = createBody(40, 30)
  for (let i = 0; i < 120; i++) stepBody(l, left, DT, ground)
  expect(Math.cos(l.angle)).toBeLessThan(-0.9)
})

// lv4 根因回归：法向投影接触解算——切向重力生效，陡坡/垂直墙不再无代价硬冲

// 平面斜率 t 的坡（地表过 (0, g0)，y 向下）：sdf = (g0 − t·x − y)/√(1+t²)，法向朝天侧
test('垂直墙：高速冲击不穿越、法向速度被移除', () => {
  const fluid = makeCalmFluid()
  const wall: TerrainLike = {
    sample: (x, _y) => 30 - x,
    normal: (_x, _y, out) => {
      out.x = -1
      out.y = 0
    },
  }
  const body = createBody(20, 20)
  body.vx = 40
  for (let i = 0; i < 60; i++) {
    stepBody(body, fluid, DT, wall)
    expect(wall.sample(body.x, body.y)).toBeGreaterThanOrEqual(0)
  }
  expect(body.x).toBeLessThanOrEqual(30)
})

test('45° 陡坡：切向重力胜过摩擦（μ=0.3），无风自然下滑', () => {
  const fluid = makeCalmFluid()
  const g0 = 40
  const t = Math.tan(Math.PI / 4)
  const norm = Math.hypot(1, t)
  const slope: TerrainLike = {
    sample: (x, y) => (g0 - t * x - y) / norm,
    normal: (_x, _y, out) => {
      out.x = -t / norm
      out.y = -1 / norm
    },
  }
  // 地表过 (20, g0−20t)：静止放置后应贴坡稳定，随后沿下坡方向（−x）滑走。
  // 切向终速 = g·sinθ − μg（空气阻力 τ=1s 封顶），须给足时间窗口
  const body = createBody(20, g0 - t * 20)
  for (let i = 0; i < 900; i++) {
    stepBody(body, fluid, DT, slope)
    expect(slope.sample(body.x, body.y)).toBeGreaterThanOrEqual(-1e-6)
  }
  expect(body.x).toBeLessThan(18)
})

test('缓坡（<摩擦角 16.7°）：摩擦停驻，不蠕动', () => {
  const fluid = makeCalmFluid()
  const g0 = 44
  const t = Math.tan(Math.PI / 18) // 10°
  const norm = Math.hypot(1, t)
  const slope: TerrainLike = {
    sample: (x, y) => (g0 - t * x - y) / norm,
    normal: (_x, _y, out) => {
      out.x = -t / norm
      out.y = -1 / norm
    },
  }
  // 下坡切向单位向量，给 0.5 初速：摩擦应把它停下且不再滑动
  const body = createBody(10, g0 - t * 10)
  body.vx = -0.5 / norm
  body.vy = 0.5 * (t / norm)
  for (let i = 0; i < 300; i++) stepBody(body, fluid, DT, slope)
  expect(Math.hypot(body.vx, body.vy)).toBe(0)
})
