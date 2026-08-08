import { expect, test } from 'vitest'
import {
  buildWindProbes,
  isLanding,
  sampleWind,
  LAND_ALT_AFTER,
  LAND_ALT_BEFORE,
  LAND_IMPACT_MIN,
} from '../app/core/wind'
import type { FluidLike } from '../app/sim/fluid'
import type { Vec2 } from '../app/sim/types'
import { createBody } from '../app/sim/bodies'

// 静态场桩：任意位置返回固定风速
function stubFluid(vx: number, vy: number): FluidLike {
  return {
    nx: 10,
    ny: 10,
    cell: 1,
    clear() {},
    setAmbient() {},
    setGroundMask() {},
    addHeat() {},
    addForce() {},
    sampleVelocity(_x: number, _y: number, out: Vec2) {
      out.x = vx
      out.y = vy
    },
    sampleTemp() {
      return 0
    },
    step() {},
  }
}

test('buildWindProbes：3×2 探针按世界比例分布', () => {
  const probes = buildWindProbes(76, 56)
  expect(probes).toHaveLength(6)
  expect(probes[0]).toEqual({ x: 0.22 * 76, y: 0.2 * 56 })
  expect(probes[probes.length - 1]).toEqual({ x: 0.78 * 76, y: 0.35 * 56 })
})

test('sampleWind：零场场强为 0、相对风 = 飞机速度；常风叠加', () => {
  const out = { x: 0, y: 0 }
  const probes = buildWindProbes(76, 56)
  const calm = stubFluid(0, 0)
  const plane = createBody(30, 20)
  plane.vx = 8
  plane.vy = -2
  let wind = sampleWind(calm, probes, plane, out)
  expect(wind.field).toBe(0)
  expect(wind.rel).toBeCloseTo(Math.hypot(8, 2), 10)

  const breeze = stubFluid(2.6, 0)
  wind = sampleWind(breeze, probes, plane, out)
  expect(wind.field).toBeCloseTo(2.6, 10)
  expect(wind.rel).toBeCloseTo(Math.hypot(8 - 2.6, 2), 10)
})

test('isLanding：跨越高度阈值且冲击速度足够才算落地', () => {
  expect(isLanding(1.0, 0.5, 1.0)).toBe(true)
  expect(isLanding(LAND_ALT_BEFORE, 0.5, 1.0)).toBe(false)
  expect(isLanding(1.0, LAND_ALT_AFTER, 1.0)).toBe(true)
  expect(isLanding(1.0, 0.5, LAND_IMPACT_MIN)).toBe(false)
  expect(isLanding(0.5, 1.0, 1.0)).toBe(false)
})
