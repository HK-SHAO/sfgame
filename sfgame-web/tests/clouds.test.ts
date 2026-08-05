import { expect, test } from 'vitest'
import { Clouds } from '../src/sim/clouds'
import { Fluid } from '../src/sim/fluid'

const WORLD = { w: 40, h: 30 }
const GROUND_Y = () => 24

function makeFluid(world = WORLD, ground = GROUND_Y) {
  const f = new Fluid({
    nx: world.w,
    ny: world.h,
    cell: 1,
    buoyancy: 2.0,
    tMax: 9,
    heatRate: 10,
    sourceRadius: 3.4,
    velDamping: 0.997,
    tDamping: 0.99,
    iterations: 12,
    vorticity: 0.5,
  })
  f.setGroundMask(ground)
  return f
}

test('同一 level id 生成可复现的初始布局，不同 id 不同', () => {
  const a = new Clouds(7, WORLD, GROUND_Y)
  const b = new Clouds(7, WORLD, GROUND_Y)
  expect(Array.from(a.x)).toEqual(Array.from(b.x))
  expect(Array.from(a.y)).toEqual(Array.from(b.y))
  expect(Array.from(a.radius)).toEqual(Array.from(b.radius))
  const c = new Clouds(8, WORLD, GROUND_Y)
  expect(Array.from(a.x)).not.toEqual(Array.from(c.x))
})

test('出生后淡入：无风时逐步接近不透明，位置基本不动', () => {
  const c = new Clouds(7, WORLD, GROUND_Y)
  const x0 = Array.from(c.x)
  const y0 = Array.from(c.y)
  const f = makeFluid()
  for (let k = 0; k < 20; k++) c.step(0.1, f)
  for (let i = 0; i < c.count; i++) {
    expect(c.alpha[i]).toBeGreaterThan(0.85)
    expect(Math.abs(c.x[i] - x0[i])).toBeLessThan(0.01)
    expect(Math.abs(c.y[i] - y0[i])).toBeLessThan(0.01)
  }
})

test('云随风水平漂移', () => {
  const c = new Clouds(7, WORLD, GROUND_Y)
  const f = makeFluid()
  f.setAmbient(2, 0)
  const x0 = Array.from(c.x)
  for (let k = 0; k < 50; k++) c.step(0.1, f)
  for (let i = 0; i < c.count; i++) {
    expect(c.x[i] - x0[i]).toBeGreaterThan(5)
  }
})

test('难下降：恒定下沉风中下降远慢于自由漂移（~2/5），且不消失', () => {
  const c = new Clouds(7, WORLD, GROUND_Y)
  const f = makeFluid()
  f.setAmbient(0, 1.6)
  const y0 = Array.from(c.y)
  for (let k = 0; k < 100; k++) c.step(0.1, f)
  for (let i = 0; i < c.count; i++) {
    const dy = c.y[i] - y0[i]
    expect(dy).toBeGreaterThan(0.2) // 确实被风压着下降
    expect(dy).toBeLessThan(8) // 自由漂移 10 秒应为 16
    expect(c.alpha[i]).toBeGreaterThan(0.8)
  }
})

test('贴地（下沉风压制）淡出消失，并按序列重生在空中', () => {
  const c = new Clouds(7, WORLD, GROUND_Y)
  c.x[0] = 20
  c.y[0] = 23
  c.alpha[0] = 1
  const f = makeFluid()
  f.setAmbient(0, 1.6)
  let dead = false
  for (let k = 0; k < 200 && !dead; k++) {
    c.step(0.1, f)
    if (c.alpha[0] <= 0.02) dead = true
  }
  expect(dead).toBe(true)
  let reborn = false
  for (let k = 0; k < 200 && !reborn; k++) {
    c.step(0.1, f)
    if (c.alpha[0] > 0.5 && c.y[0] < 21) reborn = true
  }
  expect(reborn).toBe(true)
})

test('漂出地图较远距离后淡出消失，重生回合法域', () => {
  const c = new Clouds(7, WORLD, GROUND_Y)
  c.x[0] = WORLD.w + 40
  c.y[0] = 10
  c.alpha[0] = 1
  const f = makeFluid()
  let dead = false
  for (let k = 0; k < 200 && !dead; k++) {
    c.step(0.1, f)
    if (c.alpha[0] <= 0.02) dead = true
  }
  expect(dead).toBe(true)
  let reborn = false
  for (let k = 0; k < 200 && !reborn; k++) {
    c.step(0.1, f)
    if (c.alpha[0] > 0.5 && c.y[0] < 21 && c.x[0] > -30 && c.x[0] < WORLD.w + 30) {
      reborn = true
    }
  }
  expect(reborn).toBe(true)
})

test('累积下沉达阈值提前淡出：离地尚远即消散（而非等贴地）', () => {
  // 高地形世界：贴地阈值在地面-3=37，云从 y=10 开始，下沉 16 个单位到 y≈26
  // 就应淡出——若只靠贴地规则要降到 y>37 才会触发
  const HIGH = { w: 40, h: 46 }
  const GROUND_HIGH = () => 40
  const c = new Clouds(7, HIGH, GROUND_HIGH)
  c.x[0] = 20
  c.y[0] = 10
  c.alpha[0] = 1
  const f = makeFluid(HIGH, GROUND_HIGH)
  f.setAmbient(0, 4)
  let fadedHigh = false
  for (let k = 0; k < 2000 && !fadedHigh; k++) {
    c.step(0.1, f)
    if (c.alpha[0] <= 0.02 && c.y[0] < 37) fadedHigh = true
  }
  expect(fadedHigh).toBe(true)
})
