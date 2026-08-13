import { expect, test } from 'vitest'
import {
  buildWindProbes,
  isLanding,
  sampleWind,
  LAND_ALT,
} from '../app/core/wind.ts'
import type { FluidLike } from '../app/sim/fluid.ts'
import type { Vec2 } from '../app/sim/types.ts'
import { createBody } from '../app/sim/bodies.ts'

// 静态场桩：任意位置返回固定风速
function stubFluid(vx: number, vy: number): FluidLike {
  return {
    nx: 10,
    ny: 10,
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
  const result = { field: 0, rel: 0 }
  const probes = buildWindProbes(76, 56)
  const calm = stubFluid(0, 0)
  const plane = createBody(30, 20)
  plane.vx = 8
  plane.vy = -2
  sampleWind(calm, probes, plane, out, result)
  expect(result.field).toBe(0)
  expect(result.rel).toBeCloseTo(Math.hypot(8, 2), 10)

  const breeze = stubFluid(2.6, 0)
  sampleWind(breeze, probes, plane, out, result)
  expect(result.field).toBeCloseTo(2.6, 10)
  expect(result.rel).toBeCloseTo(Math.hypot(8 - 2.6, 2), 10)
})

test('isLanding：空中→触地的下降边沿才算落地，无速度门槛（响度按 vy 调）', () => {
  expect(isLanding(1.0, 0.0, 1.0)).toBe(true) // 正常降落：静风终端 vy≈1 也触发
  expect(isLanding(LAND_ALT, 0.0, 1.0)).toBe(false) // 恰好贴地（未离地）
  expect(isLanding(1.0, 0.0, 0)).toBe(false) // 悬停触地（vy=0）
  expect(isLanding(0.0, 0.0, 1.0)).toBe(false) // 贴地滑行不触发
  expect(isLanding(0.3, 0.0, -1)).toBe(false) // 上升穿越不触发
  expect(isLanding(1.0, 0.0, 21)).toBe(true) // 高速撞击同样触发（响度按 vy 缩放）
})
