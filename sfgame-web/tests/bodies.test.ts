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
const WORLD = { w: 76, h: 56 }
const OPTS_G = { radius: 1, dragK: 3, gravity: 3 }

test('从画布外向右飞入的质点不被左边界墙拦截（开场入场）', () => {
  const fluid = makeCalmFluid()
  const body = createBody(-6, 20, { radius: 1, dragK: 3, gravity: 0 })
  body.vx = 12
  const ground = () => 100
  stepBody(body, fluid, DT, ground, WORLD)
  expect(body.x).toBeLessThan(0)
  expect(body.vx).toBeGreaterThan(11)
})

// 悬停阈值 = gravity/dragK = 1.0：上升风超过它才抬升，不足则继续下落
test('垂直风：超过悬停阈值抬升、不足则下落', () => {
  const ground = () => 100 // 地面足够深，只观察空气行为
  const up = makeCalmFluid()
  up.setAmbient(0, -2)
  const rising = createBody(30, 50, OPTS_G)
  for (let i = 0; i < 120; i++) stepBody(rising, up, DT, ground, WORLD)
  expect(rising.y).toBeLessThan(50)

  const weak = makeCalmFluid()
  weak.setAmbient(0, -0.5)
  const sinking = createBody(30, 50, OPTS_G)
  for (let i = 0; i < 120; i++) stepBody(sinking, weak, DT, ground, WORLD)
  expect(sinking.y).toBeGreaterThan(50)
})

// 地面：静息恰在地面上（不穿地），静风下惯性最终耗散停住
test('静风落地：质点静息在地面上且最终停住', () => {
  const fluid = makeCalmFluid()
  const ground = () => 40
  const body = createBody(30, 36, OPTS_G)
  body.vx = 4
  for (let i = 0; i < 600; i++) stepBody(body, fluid, DT, ground, WORLD)
  expect(body.y).toBe(40)
  expect(body.vx).toBe(0)
})

// 空气耦合：水平风持续推动贴地质点（风强度决定一切，无上坡代价/墙概念）
test('水平风推动贴地质点', () => {
  const fluid = makeCalmFluid()
  fluid.setAmbient(2, 0)
  const ground = () => 40
  const body = createBody(30, 40, OPTS_G)
  for (let i = 0; i < 240; i++) stepBody(body, fluid, DT, ground, WORLD)
  expect(body.x).toBeGreaterThan(33)
  expect(body.y).toBe(40)
})

// 机头稳稳指向运动方向（drag 使速度收敛于风，故即风向）
test('机头朝向：顺风向右飞则朝右、向左飞则朝左', () => {
  const ground = () => 100
  const right = makeCalmFluid()
  right.setAmbient(6, 0)
  const r = createBody(20, 30, OPTS_G)
  for (let i = 0; i < 120; i++) stepBody(r, right, DT, ground, WORLD)
  expect(Math.cos(r.angle)).toBeGreaterThan(0.9)

  const left = makeCalmFluid()
  left.setAmbient(-6, 0)
  const l = createBody(40, 30, OPTS_G)
  for (let i = 0; i < 120; i++) stepBody(l, left, DT, ground, WORLD)
  expect(Math.cos(l.angle)).toBeLessThan(-0.9)
})
