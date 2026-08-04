import { expect, test } from 'vitest'
import { Fluid } from '../src/sim/fluid'
import { LevelSimulation } from '../src/game/simulation'
import { LEVEL_1 } from '../src/game/levels'

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

test('物理确定性：相同输入两次模拟逐位一致（跨平台/引擎一致性的根基）', () => {
  const run = () => {
    const f = makeFluid()
    f.setGroundMask((x) => (x < 30 ? 50 : 40))
    f.setAmbient(1.5, 0)
    const u = new Float32Array(f.u.length)
    const v = new Float32Array(f.v.length)
    const t = new Float32Array(f.t.length)
    for (let s = 0; s < 240; s++) {
      f.addHeat(20 + (s % 10), 35, 6 * DT)
      f.addHeat(40, 15, -4 * DT)
      f.step(DT)
    }
    u.set(f.u)
    v.set(f.v)
    t.set(f.t)
    return { u, v, t }
  }
  const a = run()
  const b = run()
  expect(a.u).toEqual(b.u)
  expect(a.v).toEqual(b.v)
  expect(a.t).toEqual(b.t)
})

test('物理确定性：LevelSimulation 同输入两次整局逐位一致（速率/平台一致性的根基）', () => {
  const run = () => {
    const sim = new LevelSimulation(LEVEL_1)
    sim.placeSource(20, 44, 'hot', true)
    sim.placeSource(36, 28, 'hot', true)
    sim.placeSource(50, 22, 'cold', true)
    for (let i = 0; i < 360; i++) sim.step(DT)
    return { x: sim.plane.x, y: sim.plane.y, vx: sim.plane.vx, vy: sim.plane.vy, phase: sim.phase }
  }
  expect(run()).toEqual(run())
})
