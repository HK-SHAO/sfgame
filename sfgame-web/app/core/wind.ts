// 风音效的数值来源：场强度探针采样与落地判定（纯计算、无 DOM，可无头测试）
import type { FluidLike } from '../sim/fluid.ts'
import type { Body } from '../sim/bodies.ts'
import type { Vec2 } from '../sim/types.ts'

export const WIND_PROBE_FX = [0.22, 0.5, 0.78]
export const WIND_PROBE_FY = [0.2, 0.35]
// 贴地判定阈值（SDF 高度）：接触解算把质点投影到表面（alt≈0），阈值只须区分"贴地"与"贴地飞行"
export const LAND_ALT = 0.05

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
    sum += Math.sqrt(out.x * out.x + out.y * out.y)
  }
  fluid.sampleVelocity(plane.x, plane.y, out)
  return {
    field: (sum + Math.sqrt(out.x * out.x + out.y * out.y)) / (probes.length + 1),
    rel: Math.sqrt((plane.vx - out.x) * (plane.vx - out.x) + (plane.vy - out.y) * (plane.vy - out.y)),
  }
}

// 落地 = 空中→触地的下降边沿。响度由撞击前 vy 调（fb.land），不做速度门槛：
// 旧"单 tick 降幅 ≥0.35"需要 |vy|≥21 u/s，而静风终端速度仅 1 u/s——正常降落永远无声
export function isLanding(altBefore: number, altAfter: number, vyBefore: number): boolean {
  return altBefore > LAND_ALT && altAfter <= LAND_ALT && vyBefore > 0
}
