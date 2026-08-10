// 风音效的数值来源：场强度探针采样与落地判定（纯计算、无 DOM，可无头测试）
import type { FluidLike } from '../sim/fluid.ts'
import type { Body } from '../sim/bodies.ts'
import type { Vec2 } from '../sim/types.ts'

export const WIND_PROBE_FX = [0.22, 0.5, 0.78]
export const WIND_PROBE_FY = [0.2, 0.35]
export const LAND_ALT_BEFORE = 0.9
export const LAND_ALT_AFTER = 0.55
export const LAND_IMPACT_MIN = 0.8

export function buildWindProbes(w: number, h: number): Vec2[] {
  return WIND_PROBE_FX.flatMap((fx) => WIND_PROBE_FY.map((fy) => ({ x: fx * w, y: fy * h })))
}

// 场强度 = 探针均值（含飞机位）；相对风 = 飞机与当地风速差。out 为共享临时量（D4 热路径零分配）
export function sampleWind(
  fluid: FluidLike,
  probes: Vec2[],
  plane: Body,
  out: Vec2,
): { field: number; rel: number } {
  let sum = 0
  for (const pr of probes) {
    fluid.sampleVelocity(pr.x, pr.y, out)
    sum += Math.hypot(out.x, out.y)
  }
  fluid.sampleVelocity(plane.x, plane.y, out)
  return {
    field: (sum + Math.hypot(out.x, out.y)) / (probes.length + 1),
    rel: Math.hypot(plane.vx - out.x, plane.vy - out.y),
  }
}

export function isLanding(altBefore: number, altAfter: number, vyBefore: number): boolean {
  return (
    altBefore > LAND_ALT_BEFORE &&
    altAfter <= LAND_ALT_AFTER &&
    Math.abs(vyBefore) > LAND_IMPACT_MIN
  )
}
