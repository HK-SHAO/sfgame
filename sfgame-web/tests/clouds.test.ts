import { expect, test } from 'vitest'
import { CLOUD_COUNT, Clouds } from '../app/sim/clouds.ts'
import type { FluidLike } from '../app/sim/fluid.ts'
import type { TerrainLike } from '../app/sim/terrain.ts'
import type { Vec2 } from '../app/sim/types.ts'

const world = { w: 76, h: 56 }

const fakeFluid = (vx = 0.5, vy = 0): FluidLike => ({
  nx: 1,
  ny: 1,
  cell: 1,
  clear() {},
  setAmbient() {},
  setTerrain() {},
  addHeat() {},
  addForce() {},
  sampleVelocity(_x: number, _y: number, out: Vec2) {
    out.x = vx
    out.y = vy
  },
  sampleTemp: () => 0,
  step() {},
})

const fakeTerrain = (alt: () => number): TerrainLike => ({
  sample: () => alt(),
  normal(_x: number, _y: number, out: Vec2) {
    out.x = 0
    out.y = 1
  },
})

test('生成：图内均匀散布、互不贴生（P4：未生成邻居不参与间距判定）', () => {
  const c = new Clouds(1, world, fakeTerrain(() => 100))
  for (let i = 0; i < CLOUD_COUNT; i++) {
    expect(c.x[i]).toBeGreaterThan(0)
    expect(c.x[i]).toBeLessThan(world.w)
    expect(c.y[i]).toBeGreaterThan(0)
    expect(c.y[i]).toBeLessThan(world.h)
    expect(c.radius[i]).toBeGreaterThan(0)
    for (let j = 0; j < i; j++) {
      const gap = (c.radius[i] + c.radius[j]) * 1.15
      const d2 = (c.x[i] - c.x[j]) ** 2 + (c.y[i] - c.y[j]) ** 2
      expect(d2).toBeGreaterThanOrEqual(gap * gap)
    }
  }
})

test('生命周期：晴天凝结至全显，隐形后重生并重新凝结（P3/P5）', () => {
  let dist = 100
  const c = new Clouds(7, world, fakeTerrain(() => dist), 1)
  for (let i = 0; i < 240; i++) c.step(1 / 60, fakeFluid())
  expect(c.alpha[0]).toBeGreaterThan(0.9)
  const x0 = c.x[0]
  dist = 0
  for (let i = 0; i < 300; i++) c.step(1 / 60, fakeFluid())
  expect(c.alpha[0]).toBeLessThan(0.01)
  dist = 100
  for (let i = 0; i < 240; i++) c.step(1 / 60, fakeFluid())
  expect(c.alpha[0]).toBeGreaterThan(0.9)
  expect(c.x[0]).not.toBe(x0)
  expect(c.x[0]).toBeGreaterThan(0)
  expect(c.x[0]).toBeLessThan(world.w)
}, 10000)

test('迟滞：地形余量内保持消散，越过余量才恢复（P2）', () => {
  let dist = 100
  const c = new Clouds(3, world, fakeTerrain(() => dist), 1)
  for (let i = 0; i < 240; i++) c.step(1 / 60, fakeFluid())
  const a0 = c.alpha[0]
  dist = 2
  for (let i = 0; i < 60; i++) c.step(1 / 60, fakeFluid())
  const a1 = c.alpha[0]
  expect(a1).toBeLessThan(a0 - 0.3)
  dist = 3.5
  for (let i = 0; i < 60; i++) c.step(1 / 60, fakeFluid())
  const a2 = c.alpha[0]
  expect(a2).toBeLessThan(a1)
  dist = 10
  for (let i = 0; i < 120; i++) c.step(1 / 60, fakeFluid())
  const a3 = c.alpha[0]
  expect(a3).toBeGreaterThan(a2 + 0.5)
}, 10000)
