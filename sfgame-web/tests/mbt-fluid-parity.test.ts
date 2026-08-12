// Moonbit 流体内核 vs assembly 内核逐位对拍：同输入 → 场字节级一致（零符号位豁免，见 expectBitsEqual）。
// 覆盖浮力/平流/投影/sponge/环境基场/奇偶 nx 的 GS 分支差异；任一浮点结合律漂移都会在此暴露
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { bakeTerrain } from '../app/sim/terrain.ts'
import { createEngine } from '../app/wasm/engine.ts'

interface FluidFace {
  init(
    nx: number, ny: number, cell: number, buoyancy: number, tMax: number, heatRate: number,
    sourceRadius: number, velDamping: number, tDamping: number, iterations: number, marginCells: number,
  ): number
  setAmbient(x: number, y: number, temp: number): void
  rebuildSolid(): void
  addHeat(wx: number, wy: number, amount: number): void
  addForce(wx: number, wy: number, fx: number, fy: number, amount: number, radius: number): void
  step(dt: number): void
  sampleVelocity(wx: number, wy: number): void
  outX(): number
  outY(): number
  sampleTemp(wx: number, wy: number): number
  fieldU(): number
  fieldV(): number
  fieldT(): number
  solidBuf(): number
  fieldFxU(): number
  fieldFxV(): number
}

interface Engine {
  ex: FluidFace
  memory: WebAssembly.Memory
}

// AS 引擎经全局引导（tests/setup.ts）；Moonbit 产物零 import 直接实例化
function bootAs(): Engine {
  const h = createEngine()
  return { ex: h.ex as unknown as FluidFace, memory: h.memory }
}

function bootMbt(): Engine {
  const p = fileURLToPath(new URL('../app/wasm/sfengine.mbt.wasm', import.meta.url))
  const inst = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(p)), {})
  return { ex: inst.exports as unknown as FluidFace, memory: inst.exports.memory as WebAssembly.Memory }
}

function fieldView(e: Engine, ptr: number, n: number): Float32Array {
  return new Float32Array(e.memory.buffer, ptr, n)
}

// 位级比较（Uint32 视角），零的符号位除外：AS 引擎自身在 ±0 上不一致——SIMD 主路径的
// f64x2.min/max 遵循 wasm 语义（min(−0,+0)=−0），标量尾列路径的比较链忽略零符号，
// 故"含零符号逐位一致"本就不是 AS 的良定义不变量。±0 数值恒等、不涉混沌放大，豁免；
// 其余任何位差异（含 NaN 负载、非零舍入）仍然逐位严判
function expectBitsEqual(a: Float32Array, b: Float32Array, label: string) {
  expect(a.length).toBe(b.length)
  const ua = new Uint32Array(a.buffer, a.byteOffset, a.length)
  const ub = new Uint32Array(b.buffer, b.byteOffset, b.length)
  const diffs: string[] = []
  for (let i = 0; i < ua.length; i++) {
    if (ua[i] === ub[i]) continue
    const zeroSignOnly = (ua[i] === 0 || ua[i] === 0x80000000) && (ub[i] === 0 || ub[i] === 0x80000000)
    if (!zeroSignOnly) {
      diffs.push(`@${i}: as=0x${ua[i].toString(16)}(${a[i]}) mbt=0x${ub[i].toString(16)}(${b[i]})`)
    }
  }
  if (diffs.length > 0) {
    throw new Error(`${label} 位级不一致 ${diffs.length} 格：${diffs.slice(0, 8).join(' ')}`)
  }
}

interface Scenario {
  nx: number
  ny: number
  marginCells: number
  terrain: (x: number, y: number) => number
  ambient: [number, number, number]
  drive(e: Engine, dt: number): void
  steps: number
  probes: [number, number][]
}

const DT = 1 / 60

const SCENARIOS: [string, Scenario][] = [
  ['热源羽流（平地、无边距）', {
    nx: 48, ny: 36, marginCells: 0,
    terrain: (_x, y) => 45 - y,
    ambient: [0, 0, 0],
    drive: (e, dt) => {
      for (let i = 0; i < 3; i++) e.ex.addHeat(36, 38, 16 * dt)
    },
    steps: 120,
    probes: [[36, 32], [20, 20], [50, 10], [5, 40]],
  }],
  ['冷源 + 环境风 + 温度偏置', {
    nx: 48, ny: 36, marginCells: 0,
    terrain: (_x, y) => 45 - y,
    ambient: [0.3, -0.2, 1.5],
    drive: (e, dt) => {
      e.ex.addHeat(36, 20, -16 * dt)
    },
    steps: 120,
    probes: [[36, 26], [10, 30], [60, 42], [24, 5]],
  }],
  ['风扇注入 + 边距 sponge', {
    nx: 48, ny: 36, marginCells: 4,
    terrain: (_x, y) => 42 - y,
    ambient: [0.15, 0, 0],
    drive: (e) => {
      e.ex.addForce(30, 30, 1, -0.3, 0.9, 3.2)
    },
    steps: 120,
    probes: [[30, 30], [8, 24], [52, 40], [2, 2]],
  }],
  ['坡地固体 + 奇数 nx（AS 组车道 GS 分支）', {
    nx: 47, ny: 36, marginCells: 0,
    terrain: (x, y) => 40 - y + x * 0.25,
    ambient: [0.25, 0, 0.8],
    drive: (e, dt) => {
      e.ex.addHeat(20, 30, 14 * dt)
      e.ex.addHeat(50, 26, -10 * dt)
    },
    steps: 120,
    probes: [[20, 24], [50, 20], [35, 12], [6, 33]],
  }],
]

for (const [name, sc] of SCENARIOS) {
  test(`逐位一致：${name}`, () => {
    const as = bootAs()
    const mbt = bootMbt()
    const n = sc.nx * sc.ny
    const cell = 1.5
    for (const e of [as, mbt]) {
      const st = e.ex.init(
        sc.nx, sc.ny, cell, 2.0, 9, 18, 3.4, 0.996, 0.99, 12, sc.marginCells,
      )
      expect(st).toBe(0)
    }
    // 地形掩码双写 + 基场烘焙（fxU/fxV 亦须逐位一致）
    const world = { w: (sc.nx - 2 * sc.marginCells) * cell, h: (sc.ny - sc.marginCells) * cell }
    const terrain = bakeTerrain(sc.terrain, world, cell, sc.marginCells * cell)
    expect(terrain.nx).toBe(sc.nx)
    expect(terrain.ny).toBe(sc.ny)
    for (const e of [as, mbt]) {
      new Uint8Array(e.memory.buffer, e.ex.solidBuf(), n).set(terrain.mask)
      e.ex.rebuildSolid()
      e.ex.setAmbient(sc.ambient[0], sc.ambient[1], sc.ambient[2])
    }
    expectBitsEqual(fieldView(as, as.ex.fieldFxU(), n), fieldView(mbt, mbt.ex.fieldFxU(), n), `${name} fxU`)
    expectBitsEqual(fieldView(as, as.ex.fieldFxV(), n), fieldView(mbt, mbt.ex.fieldFxV(), n), `${name} fxV`)

    for (let i = 0; i < sc.steps; i++) {
      sc.drive(as, DT)
      as.ex.step(DT)
      sc.drive(mbt, DT)
      mbt.ex.step(DT)
    }

    expectBitsEqual(fieldView(as, as.ex.fieldU(), n), fieldView(mbt, mbt.ex.fieldU(), n), `${name} u`)
    expectBitsEqual(fieldView(as, as.ex.fieldV(), n), fieldView(mbt, mbt.ex.fieldV(), n), `${name} v`)
    expectBitsEqual(fieldView(as, as.ex.fieldT(), n), fieldView(mbt, mbt.ex.fieldT(), n), `${name} t`)

    for (const [px, py] of sc.probes) {
      as.ex.sampleVelocity(px, py)
      const ax = as.ex.outX()
      const ay = as.ex.outY()
      const at = as.ex.sampleTemp(px, py)
      mbt.ex.sampleVelocity(px, py)
      const eq = (m: number, a: number) => Object.is(m, a) || (m === 0 && a === 0)
      expect(eq(mbt.ex.outX(), ax), `vx@(${px},${py})`).toBe(true)
      expect(eq(mbt.ex.outY(), ay), `vy@(${px},${py})`).toBe(true)
      expect(eq(mbt.ex.sampleTemp(px, py), at), `temp@(${px},${py})`).toBe(true)
    }
  })
}

test('步进性能：Moonbit 标量 vs assembly SIMD（观测值，宽松上限防数量级退化）', () => {
  const cell = 1.5
  const mk = (e: Engine) => {
    e.ex.init(160, 120, cell, 2.0, 9, 18, 3.4, 0.996, 0.99, 12, 0)
    const terrain = bakeTerrain((_x, y) => 150 - y, { w: 240, h: 180 }, cell, 0)
    new Uint8Array(e.memory.buffer, e.ex.solidBuf(), 160 * 120).set(terrain.mask)
    e.ex.rebuildSolid()
  }
  const as = bootAs()
  const mbt = bootMbt()
  mk(as)
  mk(mbt)
  const bench = (e: Engine, iters: number): number => {
    const t0 = performance.now()
    for (let i = 0; i < iters; i++) {
      e.ex.addHeat(120, 140, 0.27)
      e.ex.step(DT)
    }
    return performance.now() - t0
  }
  bench(as, 5)
  bench(mbt, 5)
  const msAs = bench(as, 30)
  const msMbt = bench(mbt, 30)
  console.log(`    [parity-bench] 满网格 30 步：as=${msAs.toFixed(1)}ms mbt=${msMbt.toFixed(1)}ms 比值=${(msMbt / msAs).toFixed(2)}`)
  // 宽松红线：单帧（1 步）不得超过约 16ms 量级（标量版若数量级退化说明需要 SIMD 微内核）
  expect(msMbt / 30).toBeLessThan(16)
})
