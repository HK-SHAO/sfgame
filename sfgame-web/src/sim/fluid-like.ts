/**
 * 流体引擎公共接口：JS（fluid.ts）与 wasm（fluid-wasm.ts）双实现。
 * 两套实现逐位一致（f32 存储 + f64 中间量 + 同运算次序），运行中可无感切换。
 */
import type { FluidConfig } from './fluid'
import type { Vec2 } from './types'

export interface FluidLike {
  readonly nx: number
  readonly ny: number
  readonly cell: number
  readonly tMax: number
  readonly engine: 'js' | 'wasm'
  u: Float32Array
  v: Float32Array
  t: Float32Array
  solid: Uint8Array
  clear(): void
  setAmbient(x: number, y: number): void
  setGroundMask(groundY: (x: number) => number): void
  addHeat(wx: number, wy: number, amount: number): void
  sampleVelocity(wx: number, wy: number, out: Vec2): void
  sampleTemp(wx: number, wy: number): number
  step(dt: number): void
}

export type { FluidConfig }
