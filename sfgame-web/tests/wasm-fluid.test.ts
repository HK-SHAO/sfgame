import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { Fluid, type FluidConfig } from '../src/sim/fluid'
import { createFluid, initWasm, setBackendPref, simdAvailable, WasmFluid } from '../src/sim/wasm-fluid'
import { LEVELS } from '../src/game/levels'
import { LevelSimulation } from '../src/game/simulation'
import { solutionsFor } from '../src/game/solutions'

const wasmPath = fileURLToPath(new URL('../src/sim/wasm/sfsim.wasm', import.meta.url))
const loadWasm = () => initWasm(readFileSync(wasmPath))

// 与 simulation.ts 的 FLUID_TUNING 对齐，真实关卡尺寸
const CFG: FluidConfig = {
  nx: 101,
  ny: 75,
  cell: 0.75,
  buoyancy: 2.0,
  tMax: 9,
  heatRate: 10,
  sourceRadius: 3.4,
  velDamping: 0.997,
  tDamping: 0.99,
  iterations: 12,
  vorticity: 0.5,
}
const DT = 1 / 60
const STEPS = 360

// 同一激励下逐格对比 JS 与 WASM 场。
// 不变量：AS 内核 f64 车道运算与 JS 的 f64 中间量语义逐位一致 → 两后端逐位相同；
// 混沌流场下任何位级偏差都会指数放大并破坏解法可通关性，故零容差
function fieldParity() {
  expect(simdAvailable()).toBe(true)
  expect(loadWasm()).toBe(true)
  setBackendPref('wasm')
  const js = new Fluid(CFG)
  const wasm = createFluid(CFG)
  expect(wasm).toBeInstanceOf(WasmFluid)
  const ground = (x: number) => 42 + Math.sin(x * 0.2) * 4
  js.setGroundMask(ground)
  wasm.setGroundMask(ground)
  for (let i = 0; i < STEPS; i++) {
    js.addHeat(38, 38, CFG.heatRate * DT)
    js.addHeat(60, 20, -CFG.heatRate * DT)
    js.step(DT)
    wasm.addHeat(38, 38, CFG.heatRate * DT)
    wasm.addHeat(60, 20, -CFG.heatRate * DT)
    wasm.step(DT)
  }
  const { u, v, t } = (wasm as WasmFluid).fieldViews()
  const n = CFG.nx * CFG.ny
  let maxU = 0
  let maxV = 0
  let maxT = 0
  for (let i = 0; i < n; i++) {
    maxU = Math.max(maxU, Math.abs(js.u[i] - u[i]))
    maxV = Math.max(maxV, Math.abs(js.v[i] - v[i]))
    maxT = Math.max(maxT, Math.abs(js.t[i] - t[i]))
  }
  expect(maxU, `Δu=${maxU}`).toBe(0)
  expect(maxV, `Δv=${maxV}`).toBe(0)
  expect(maxT, `Δt=${maxT}`).toBe(0)
}

test('WASM 场与 JS 逐位一致（f64 车道语义镜像）', fieldParity)

// 关键玩法一致性：注册解在 WASM 后端仍通关且耗时与记录一致（±2s）——切换后端不破坏关卡
test('所有注册解在 WASM 后端通关时间与记录一致（±2s）', () => {
  expect(loadWasm()).toBe(true)
  setBackendPref('wasm')
  for (const level of LEVELS) {
    for (const s of solutionsFor(level.id)) {
      const sim = new LevelSimulation(level)
      expect(sim.fluid, `${level.id} 应使用 WASM 后端`).toBeInstanceOf(WasmFluid)
      for (const src of s.sources) sim.placeSource(src.x, src.y, src.kind)
      let winAt = -1
      for (let t = 0; t < 45; t += DT) {
        sim.step(DT)
        if (sim.phase === 'won') {
          winAt = t
          break
        }
      }
      expect(winAt, `${level.id}「${s.name}」WASM 下未通关`).toBeGreaterThan(0)
      expect(Math.abs(winAt - s.winTime), `${level.id}「${s.name}」WASM 通关时间偏移`).toBeLessThan(2)
    }
  }
}, 30000)

test('超容量或强制 JS 时回退 JS 后端', () => {
  expect(loadWasm()).toBe(true)
  setBackendPref('wasm')
  const oversized = createFluid({ ...CFG, nx: 400, ny: 300 })
  expect(oversized).toBeInstanceOf(Fluid)
  setBackendPref('js')
  expect(createFluid(CFG)).toBeInstanceOf(Fluid)
  setBackendPref('auto')
})
