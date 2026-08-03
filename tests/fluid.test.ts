import { expect, test } from 'bun:test'
import { Fluid } from '../src/sim/fluid'

function makeFluid() {
  return new Fluid({
    nx: 48,
    ny: 36,
    cell: 1.5,
    buoyancy: 2.0,
    tMax: 9,
    heatRate: 18,
    sourceRadius: 3.4,
    velDamping: 0.996,
    tDamping: 0.99,
    iterations: 12,
    vorticity: 0.5,
  })
}

const DT = 1 / 60

test('热源上方产生上升气流（y 向下，上升即 v < 0）', () => {
  const f = makeFluid()
  const wx = 36
  const wy = 38
  for (let i = 0; i < 120; i++) {
    f.addHeat(wx, wy, 16 * DT)
    f.step(DT)
  }
  const air = { x: 0, y: 0 }
  f.sampleVelocity(wx, wy - 6, air)
  expect(air.y).toBeLessThan(0)
  expect(-air.y).toBeGreaterThan(2)
})

test('热源侧下方产生横向补充气流（对流闭合）', () => {
  const f = makeFluid()
  const wx = 36
  const wy = 38
  for (let i = 0; i < 120; i++) {
    f.addHeat(wx, wy, 16 * DT)
    f.step(DT)
  }
  const air = { x: 0, y: 0 }
  f.sampleVelocity(wx - 8, wy + 2, air)
  expect(air.x).toBeGreaterThan(0)
})

test('冷源产生下沉气流', () => {
  const f = makeFluid()
  const wx = 36
  const wy = 20
  for (let i = 0; i < 120; i++) {
    f.addHeat(wx, wy, -16 * DT)
    f.step(DT)
  }
  const air = { x: 0, y: 0 }
  f.sampleVelocity(wx, wy + 6, air)
  expect(air.y).toBeGreaterThan(0)
})

test('温度场被 tMax 钳制', () => {
  const f = makeFluid()
  for (let i = 0; i < 300; i++) {
    f.addHeat(30, 30, 16 * DT)
    f.step(DT)
  }
  let maxT = 0
  for (let i = 0; i < f.t.length; i++) {
    if (f.t[i] > maxT) maxT = f.t[i]
  }
  expect(maxT).toBeLessThanOrEqual(9 + 1e-4)
  expect(maxT).toBeGreaterThan(0)
})

test('固体掩码内无速度', () => {
  const f = makeFluid()
  f.setGroundMask(() => 45)
  f.addHeat(30, 40, 5)
  for (let i = 0; i < 60; i++) f.step(DT)
  const air = { x: 0, y: 0 }
  f.sampleVelocity(30, 46.5, air)
  expect(Math.abs(air.x)).toBe(0)
  expect(Math.abs(air.y)).toBe(0)
})
