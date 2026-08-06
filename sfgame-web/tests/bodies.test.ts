import { expect, test } from 'vitest'
import { createBody, stepBody } from '../src/sim/bodies'
import { createFluid } from '../src/sim/fluid'

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

// 悬停需垂直风 ≥ gravity/dragK = 1.0；贴地耦合衰减 0.6 → 贴地阈值更高
test('贴地边界层：贴地悬停所需垂直风高于空中，强风仍可撬起', () => {
  const ground = () => 40
  const OPTS_G = { radius: 1, dragK: 3, gravity: 3 }

  const fluid = makeCalmFluid()
  fluid.setAmbient(0, -1.5)
  const air = createBody(10, 30, OPTS_G)
  for (let i = 0; i < 120; i++) stepBody(air, fluid, DT, ground, WORLD)
  expect(air.y).toBeLessThan(30)
  const gnd = createBody(10, 39.6, OPTS_G)
  for (let i = 0; i < 120; i++) stepBody(gnd, fluid, DT, ground, WORLD)
  expect(gnd.y).toBeGreaterThanOrEqual(39.5)

  const strong = makeCalmFluid()
  strong.setAmbient(0, -2.5)
  const body = createBody(10, 39.6, OPTS_G)
  for (let i = 0; i < 120; i++) stepBody(body, strong, DT, ground, WORLD)
  expect(body.y).toBeLessThan(39.5)
})
