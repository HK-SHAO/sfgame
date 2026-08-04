import { expect, test } from 'vitest'
import { createBody, stepBody } from '../src/sim/bodies'
import { Fluid } from '../src/sim/fluid'

/** 静止空气的小流体：stepBody 需要风速采样，此处恒为零风。 */
function makeCalmFluid() {
  return new Fluid({
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

test('从画布外向右飞入的物体不被左边界墙拦截（开场入场）', () => {
  const fluid = makeCalmFluid()
  const body = createBody(-6, 20, OPTS)
  body.vx = 12
  const ground = () => 100
  const world = { w: 76, h: 56 }
  // 第一步：不应被墙夹到 x=1、也不应被削速，只有气动衰减
  stepBody(body, fluid, DT, ground, world)
  expect(body.x).toBeLessThan(0)
  expect(body.x).toBeGreaterThan(-6)
  expect(body.vx).toBeGreaterThan(11)
  // 继续飞行：平滑进入世界，无瞬移
  for (let i = 0; i < 59; i++) stepBody(body, fluid, DT, ground, world)
  expect(body.x).toBeGreaterThan(-4)
})

test('世界内向左运动的物体在左墙反弹（不飞出场外）', () => {
  const fluid = makeCalmFluid()
  const body = createBody(2.5, 20, OPTS)
  body.vx = -10
  const ground = () => 100
  const world = { w: 76, h: 56 }
  for (let i = 0; i < 30; i++) stepBody(body, fluid, DT, ground, world)
  expect(body.x).toBeGreaterThanOrEqual(1)
  expect(body.vx).toBeGreaterThan(0)
})

test('崖壁视为墙：一帧内陡坡抬升禁止 snap 爬升，横向弹回', () => {
  const fluid = makeCalmFluid()
  // x<10 平地 y=40，x>=10 悬崖顶 y=10
  const ground = (x: number) => (x < 10 ? 40 : 10)
  const body = createBody(9.4, 39.5, OPTS)
  body.vx = 60
  const world = { w: 76, h: 56 }
  stepBody(body, fluid, DT, ground, world)
  expect(body.x).toBeLessThan(10)
  expect(body.vx).toBeLessThan(0)
  expect(body.y).toBeGreaterThan(30)
})

test('缓坡可贴地滑行：高度随地形平滑抬升，不触发崖壁弹回', () => {
  const fluid = makeCalmFluid()
  const ground = (x: number) => 40 - 0.3 * x
  const body = createBody(4, 40 - 0.3 * 4 - 0.5, OPTS)
  body.vx = 6
  const world = { w: 76, h: 56 }
  for (let i = 0; i < 5; i++) stepBody(body, fluid, DT, ground, world)
  expect(body.x).toBeGreaterThan(4)
  expect(body.vx).toBeGreaterThan(0)
  expect(body.y).toBeCloseTo(ground(body.x) - 0.5, 1)
})

test('地面摩擦：贴地物体速度被强阻尼', () => {
  const fluid = makeCalmFluid()
  const ground = () => 40
  const body = createBody(10, 39.6, OPTS)
  body.vx = 8
  const world = { w: 76, h: 56 }
  stepBody(body, fluid, DT, ground, world)
  expect(body.y).toBeCloseTo(39.5, 5)
  expect(body.vx).toBeLessThan(8 * 0.4)
})

/** 贴地物理测试：掉到地上后"特别难再起飞、很难贴地滑动"（地面边界层模型）。
 * 用真实重力（gravity=3，与游戏内纸飞机一致）：悬停需垂直风 ≥ gravity/dragK = 1.0。 */
const OPTS_G = { radius: 1, dragK: 3, gravity: 3 }

test('贴地难起飞：贴地悬停所需的垂直风高于空中（边界层耦合衰减）', () => {
  // 垂直上升风 -1.5：空中可托起（> 1.0 阈值），贴地（耦合 0.6 → 有效 0.9）托不起
  const fluid = makeCalmFluid()
  fluid.setAmbient(0, -1.5)
  const ground = () => 40
  const world = { w: 76, h: 56 }
  const air = createBody(10, 30, OPTS_G)
  for (let i = 0; i < 120; i++) stepBody(air, fluid, DT, ground, world)
  expect(air.y).toBeLessThan(30) // 空中被托起上升
  const gnd = createBody(10, 39.6, OPTS_G)
  for (let i = 0; i < 120; i++) stepBody(gnd, fluid, DT, ground, world)
  expect(gnd.y).toBeGreaterThanOrEqual(39.5) // 贴地保持贴地（托不起）
})

test('贴地强风可撬起：垂直风超过贴地阈值后飞机离地', () => {
  // -2.5 强风：贴地有效 -1.5 > 1.0 → 撬起（"难"但可救，与源正下方风强 ~2.2+ 对应）
  const fluid = makeCalmFluid()
  fluid.setAmbient(0, -2.5)
  const ground = () => 40
  const world = { w: 76, h: 56 }
  const body = createBody(10, 39.6, OPTS_G)
  for (let i = 0; i < 120; i++) stepBody(body, fluid, DT, ground, world)
  expect(body.y).toBeLessThan(39.5) // 被撬离地面
})

test('贴地几乎不被水平风滑动：环境风下贴地位移极小，空中随风飘移', () => {
  const fluid = makeCalmFluid()
  fluid.setAmbient(1.8, 0) // 关卡环境风（水平）
  const ground = () => 40
  const world = { w: 76, h: 56 }
  const gnd = createBody(10, 39.6, OPTS_G)
  for (let i = 0; i < 60 * 5; i++) stepBody(gnd, fluid, DT, ground, world)
  expect(Math.abs(gnd.x - 10)).toBeLessThan(1) // 5 秒水平位移 < 1（贴地滑动极难）
  const air = createBody(10, 20, OPTS_G)
  for (let i = 0; i < 60 * 5; i++) stepBody(air, fluid, DT, ground, world)
  expect(air.x - 10).toBeGreaterThan(5) // 空中被环境风带走（对照）
})
