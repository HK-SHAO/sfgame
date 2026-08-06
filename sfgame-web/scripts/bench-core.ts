// 流体内核规模基准共享核心（bun 无头与浏览器端同一份测量逻辑，保证口径一致）。
// 测对象：fluid.step(1/60) 全链路（浮力→涡度→MacCormack 平流×3→12 迭代 GS 投影→边界），
// 参数固定为 LevelSimulation.FLUID_TUNING + cell=0.75（与现行关卡一致）。
// 统计：预热后逐 step 计时，min/median/p95；吞吐 = 格数 / median。

import { createEngine } from '../src/wasm/engine'
import { WasmFluid, type FluidConfig } from '../src/sim/fluid'

export const FLUID_PARAMS = {
  buoyancy: 2.0,
  tMax: 9,
  heatRate: 10,
  sourceRadius: 3.4,
  velDamping: 0.997,
  tDamping: 0.99,
  iterations: 12,
  vorticity: 0.5,
} as const

export const CELL = 0.75

// 规模矩阵：aspect 1.33（与现状关卡 101×75 一致），末档 = 编译容量上限 160×120
export const SCALES = [
  { nx: 64, ny: 48 },
  { nx: 80, ny: 60 },
  { nx: 96, ny: 72 },
  { nx: 101, ny: 75 },
  { nx: 112, ny: 84 },
  { nx: 128, ny: 96 },
  { nx: 144, ny: 108 },
  { nx: 160, ny: 120 },
] as const

// 地面形态 ×2：全流体（SIMD 8 格组全命中）vs level-1 谷地（固体→GS 边界表分支）
function smoothstep01(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}

export const GROUNDS = [
  { name: 'open', groundY: () => Infinity },
  { name: 'valley', groundY: (x: number) => 42 + 8 * smoothstep01(x / 30) },
] as const

export interface BenchRow {
  nx: number
  ny: number
  cells: number
  ground: string
  min: number
  median: number
  p95: number
  perMs: number
  steps: number
}

export interface BenchResult {
  rows: BenchRow[]
  capacityRejected: boolean
}

const DT = 1 / 60
const WARM = 200
const PROBE = 50
const GROUP_MS = 10
const TARGET_MS = 300
const MIN_GROUPS = 40
const MAX_GROUPS = 2000

function stats(times: number[]): { min: number; median: number; p95: number } {
  const s = [...times].sort((a, b) => a - b)
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
  return { min: s[0], median: q(0.5), p95: q(0.95) }
}

function runScale(nx: number, ny: number, groundY: (x: number) => number): BenchRow {
  const engine = createEngine()
  const cfg: FluidConfig = { nx, ny, cell: CELL, ...FLUID_PARAMS }
  const f = WasmFluid.create(cfg, engine)
  if (!f) throw new Error(`init 拒绝 nx=${nx} ny=${ny}（超编译容量？）`)
  f.setGroundMask(groundY)
  f.addHeat((nx * CELL) / 2, (ny * CELL) / 3, 10)
  f.addHeat((nx * CELL) / 3, (ny * CELL) / 2, -8)
  for (let i = 0; i < WARM; i++) f.step(DT)
  const probeT0 = performance.now()
  for (let i = 0; i < PROBE; i++) f.step(DT)
  const est = (performance.now() - probeT0) / PROBE
  // 分组计时：组目标 ~10ms（Safari 时钟粒度 ~1ms 下逐 step 计时失真），组均值参与统计
  const group = Math.max(1, Math.round(GROUP_MS / est))
  const groups = Math.min(MAX_GROUPS, Math.max(MIN_GROUPS, Math.round(TARGET_MS / (est * group))))
  const times = new Array<number>(groups)
  for (let k = 0; k < groups; k++) {
    const t0 = performance.now()
    for (let g = 0; g < group; g++) f.step(DT)
    times[k] = (performance.now() - t0) / group
  }
  const { min, median, p95 } = stats(times)
  return { nx, ny, cells: nx * ny, ground: '', min, median, p95, perMs: (nx * ny) / median, steps: groups * group }
}

// 容量边界 sanity：161×121 必须被 init 拒绝（WasmFluid.create 返回 null）
export function checkCapacityBoundary(): boolean {
  const engine = createEngine()
  const cfg: FluidConfig = { nx: 161, ny: 121, cell: CELL, ...FLUID_PARAMS }
  return WasmFluid.create(cfg, engine) === null
}

export async function runBench(onRow?: (row: BenchRow, i: number) => void): Promise<BenchResult> {
  const rows: BenchRow[] = []
  let i = 0
  for (const { nx, ny } of SCALES) {
    for (const g of GROUNDS) {
      const row = runScale(nx, ny, g.groundY)
      row.ground = g.name
      rows.push(row)
      onRow?.(row, i++)
    }
  }
  return { rows, capacityRejected: checkCapacityBoundary() }
}
