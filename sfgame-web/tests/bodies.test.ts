import { expect, test } from 'vitest'
import { createBody, stepBody } from '../app/sim/bodies'
import { createFluid } from '../app/sim/fluid'

function makeCalmFluid() {
  return createFluid({
    nx: 8,
    ny: 8,
    cell: 10,
    buoyancy: 0,
    tMax: 9,
    heatRate: 0,
    sourceRadius: 1,
    velDamping: 1,
    tDamping: 1,
    iterations: 2,
    vorticity: 0,
  })
}

const DT = 1 / 60
const OPTS = { radius: 1, dragK: 3, gravity: 0 }
const WORLD = { w: 76, h: 56 }

test('从画布外向右飞入的物体不被左边界墙拦截（开场入场）', () => {
  const fluid = makeCalmFluid()
  const body = createBody(-6, 20, OPTS)
  body.vx = 12
  const ground = () => 100
  stepBody(body, fluid, DT, ground, WORLD)
  expect(body.x).toBeLessThan(0)
  expect(body.x).toBeGreaterThan(-6)
  expect(body.vx).toBeGreaterThan(11)
  for (let i = 0; i < 59; i++) stepBody(body, fluid, DT, ground, WORLD)
  expect(body.x).toBeGreaterThan(-4)
})

test('崖壁视为墙：一帧内陡坡抬升禁止 snap 爬升，横向弹回', () => {
  const fluid = makeCalmFluid()
  const ground = (x: number) => (x < 10 ? 40 : 10)
  const body = createBody(9.4, 39.5, OPTS)
  body.vx = 60
  stepBody(body, fluid, DT, ground, WORLD)
  expect(body.x).toBeLessThan(10)
  expect(body.vx).toBeLessThan(0)
  expect(body.y).toBeGreaterThan(30)
})

// 悬停需垂直风 ≥ gravity/dragK = 1.0；贴地耦合衰减 0.8 → 贴地阈值 ≈1.25（#25：适度风即可重新带飞）
test('贴地边界层：贴地悬停所需垂直风略高于空中，强风可重新带飞', () => {
  const ground = () => 40
  const OPTS_G = { radius: 1, dragK: 3, gravity: 3 }

  const fluid = makeCalmFluid()
  fluid.setAmbient(0, -1.2)
  const air = createBody(10, 30, OPTS_G)
  for (let i = 0; i < 120; i++) stepBody(air, fluid, DT, ground, WORLD)
  expect(air.y).toBeLessThan(30)
  // 贴地基准 = ground - REST_OFFSET(1.1)：弱风压不破
  const gnd = createBody(10, 39.6, OPTS_G)
  for (let i = 0; i < 120; i++) stepBody(gnd, fluid, DT, ground, WORLD)
  expect(gnd.y).toBeGreaterThanOrEqual(38.8)

  const strong = makeCalmFluid()
  strong.setAmbient(0, -2.0)
  const body = createBody(10, 39.6, OPTS_G)
  for (let i = 0; i < 120; i++) stepBody(body, strong, DT, ground, WORLD)
  expect(body.y).toBeLessThan(39.5)
})

// #25 光滑地面：1.5:1 坡可借水平速度滑爬（斜率 < MAX_SLIDE_SLOPE=2.0，不被 snap 弹回）
test('光滑地面：中坡可用水平速度滑爬抬升，不被 snap 弹回', () => {
  const fluid = makeCalmFluid()
  // 1.5:1 坡：x∈[20,40] 地面 40 → 10（右升坡）
  const ground = (x: number) => (x < 20 ? 40 : 40 - 1.5 * (x - 20))
  const body = createBody(16, 39.5, { radius: 1, dragK: 3, gravity: 3 })
  body.vx = 30
  for (let i = 0; i < 240; i++) stepBody(body, fluid, DT, ground, WORLD)
  expect(body.x).toBeGreaterThan(22.5)
  expect(body.y).toBeLessThan(ground(body.x) - 0.4)
})

// #25 光滑地面：贴地水平速度不被强杀（不"卡住"），顺坡自然滑下（右下降坡）
test('光滑地面：贴地滑行保留水平速度，沿坡下滑', () => {
  const fluid = makeCalmFluid()
  const ground = (x: number) => 20 + 1 * x // 右下降坡（下坡向右）
  const body = createBody(10, 29.6, { radius: 1, dragK: 3, gravity: 3 })
  body.vx = 0
  for (let i = 0; i < 480; i++) stepBody(body, fluid, DT, ground, WORLD)
  expect(body.x).toBeGreaterThan(12.5)
  expect(body.vx).toBeGreaterThan(0.2)
})

// #28 空气动力学：贴地时顺着地面——机头不插地，角度对齐坡面
test('贴地姿态：机身悬浮在地面上方、角度对齐坡面', () => {
  const fluid = makeCalmFluid()
  // 1:1 坡（右下降坡）：贴地后角度应 ≈ atan(1)=π/4
  const ground = (x: number) => 30 + 1 * (x - 10)
  const body = createBody(10, 30.5, { radius: 1, dragK: 3, gravity: 3 })
  body.vx = 10
  for (let i = 0; i < 240; i++) stepBody(body, fluid, DT, ground, WORLD)
  // 滑行有 ±0.3 的逐帧微弹跳容差
  expect(body.y).toBeGreaterThanOrEqual(ground(body.x) - 1.1 - 0.3)
  expect(Math.abs(body.angle - Math.PI / 4)).toBeLessThan(0.2)
})
