import { afterAll, expect, test } from 'vitest'
import { Fluid, type FluidConfig } from '../src/sim/fluid'
import { createFluid, loadFluidWasm, setFluidEngine, WasmFluid } from '../src/sim/fluid-wasm'
import { FLUID_TUNING, LevelSimulation } from '../src/game/simulation'
import { LEVEL_1 } from '../src/game/levels'

const DT = 1 / 60
const N = 600

function levelCfg(): FluidConfig {
  const { w, h, cell } = LEVEL_1.world
  return { nx: Math.round(w / cell), ny: Math.round(h / cell), cell, ...FLUID_TUNING }
}

/** 逐位比较：f32 位级一致（=== 即同比特）。*/
function expectBitwiseEqual(a: Float32Array, b: Float32Array, label: string) {
  if (a.length !== b.length) throw new Error(`${label} 长度不一致`)
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      throw new Error(`${label}[${i}] 不一致：${a[i]} vs ${b[i]}`)
    }
  }
}

async function loadWasm() {
  const ok = await loadFluidWasm()
  if (!ok) throw new Error('wasm 求解器加载失败')
}

test('wasm 求解器加载并可用', async () => {
  await loadWasm()
  const f = new WasmFluid(levelCfg())
  expect(f.engine).toBe('wasm')
  expect(f.nx).toBe(LEVEL_1.world.w / LEVEL_1.world.cell | 0 + 1)
})

test('流体场逐位一致：600 步 addHeat + step 后 u/v/t 完全相同', async () => {
  await loadWasm()
  const js = new Fluid(levelCfg())
  const wm = new WasmFluid(levelCfg())
  const ground = LEVEL_1.ground
  js.setGroundMask(ground)
  wm.setGroundMask(ground)
  js.setAmbient(1.8, 0)
  wm.setAmbient(1.8, 0)
  const spots: Array<[number, number, number]> = [
    [18, 42, 1],
    [30, 40, 1],
    [44, 30, 1],
    [52, 24, -1],
  ]
  const rate = 10 * DT
  for (let s = 0; s < N; s++) {
    for (const [x, y, k] of spots) {
      js.addHeat(x, y, k > 0 ? rate : -rate)
      wm.addHeat(x, y, k > 0 ? rate : -rate)
    }
    js.step(DT)
    wm.step(DT)
    if ((s + 1) % 120 === 0) {
      expectBitwiseEqual(js.u, wm.u, 'u')
      expectBitwiseEqual(js.v, wm.v, 'v')
      expectBitwiseEqual(js.t, wm.t, 't')
    }
  }
  expectBitwiseEqual(js.u, wm.u, 'u(终)')
  expectBitwiseEqual(js.v, wm.v, 'v(终)')
  expectBitwiseEqual(js.t, wm.t, 't(终)')
}, 30000)

test('整局逐位一致：LevelSimulation 同源 600 步后飞机状态完全一致', async () => {
  await loadWasm()
  const jsSim = new LevelSimulation(LEVEL_1)
  const wmSim = new LevelSimulation(LEVEL_1, new WasmFluid(levelCfg()))
  const spots: Array<[number, number, 'hot' | 'cold']> = [
    [18, 42, 'hot'],
    [30, 40, 'hot'],
    [44, 30, 'hot'],
    [52, 24, 'cold'],
  ]
  for (const [x, y, kind] of spots) {
    jsSim.placeSource(x, y, kind, true)
    wmSim.placeSource(x, y, kind, true)
  }
  for (let i = 0; i < N; i++) {
    jsSim.step(DT)
    wmSim.step(DT)
  }
  expect(wmSim.plane.x).toBe(jsSim.plane.x)
  expect(wmSim.plane.y).toBe(jsSim.plane.y)
  expect(wmSim.plane.vx).toBe(jsSim.plane.vx)
  expect(wmSim.plane.vy).toBe(jsSim.plane.vy)
  expect(wmSim.phase).toBe(jsSim.phase)
  expect(wmSim.time).toBe(jsSim.time)
  // 采样 API 一致性抽查（读同一份场数据，应与 JS 引擎结果相同）
  const airJs = { x: 0, y: 0 }
  const airWm = { x: 0, y: 0 }
  jsSim.fluid.sampleVelocity(30, 20, airJs)
  wmSim.fluid.sampleVelocity(30, 20, airWm)
  expect(airWm.x).toBe(airJs.x)
  expect(airWm.y).toBe(airJs.y)
  expect(wmSim.fluid.sampleTemp(30, 20)).toBe(jsSim.fluid.sampleTemp(30, 20))
}, 30000)

test('clear 逐位一致（restart 语义：清场后场全零）', async () => {
  await loadWasm()
  const js = new Fluid(levelCfg())
  const wm = new WasmFluid(levelCfg())
  js.setGroundMask(LEVEL_1.ground)
  wm.setGroundMask(LEVEL_1.ground)
  for (let s = 0; s < 120; s++) {
    js.addHeat(18, 42, 10 * DT)
    wm.addHeat(18, 42, 10 * DT)
    js.step(DT)
    wm.step(DT)
  }
  js.clear()
  wm.clear()
  expectBitwiseEqual(js.u, wm.u, 'u(clear)')
  expectBitwiseEqual(js.v, wm.v, 'v(clear)')
  expectBitwiseEqual(js.t, wm.t, 't(clear)')
  expect(wm.u.some((v) => v !== 0)).toBe(false)
})

test('createFluid 按引擎模式选择实现', async () => {
  const cfg = levelCfg()
  setFluidEngine('js')
  expect(createFluid(cfg).engine).toBe('js')
  await loadWasm()
  setFluidEngine('wasm')
  expect(createFluid(cfg).engine).toBe('wasm')
  setFluidEngine('auto')
  // auto + 未做弱引擎探测 → JS 兜底
  expect(createFluid(cfg).engine).toBe('js')
})

afterAll(() => {
  setFluidEngine('auto')
})
