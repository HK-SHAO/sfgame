import { expect, test } from 'vitest'
import { createEngine } from '../app/wasm/engine.ts'
import { createFluid, type FluidConfig } from '../app/sim/fluid.ts'
import { Tracers, TRAIL_LEN } from '../app/sim/particles.ts'
import { bakeTerrain } from '../app/sim/terrain.ts'

const WORLD = { w: 60, h: 40 }
const GROUND_Y = 38
const CFG: FluidConfig = {
  nx: 48,
  ny: 31,
  cell: 1.5,
  buoyancy: 0,
  tMax: 9,
  heatRate: 0,
  sourceRadius: 3.4,
  velDamping: 1,
  tDamping: 1,
  iterations: 12,
  margin: 6,
}

const DT = 1 / 60
const SEED = 12345

// 内核采样直调流体（同模块），须先在同一引擎实例上初始化流体场
function build() {
  const engine = createEngine()
  const fluid = createFluid(CFG, engine)
  const terrain = bakeTerrain((_x, y) => GROUND_Y - y, WORLD, CFG.cell, 6)
  fluid.setTerrain(terrain)
  fluid.setAmbient(2, 0)
  const tracers = new Tracers(engine, 400, WORLD, terrain, TRAIL_LEN, 6, SEED)
  return { fluid, tracers }
}

test('初始化 scatter 重生在域内：水平 [0.5, w-0.5]、垂直贴地天花板以下', () => {
  const { tracers } = build()
  expect(tracers.time).toBe(0)
  for (let i = 0; i < tracers.count; i++) {
    expect(tracers.x[i]).toBeGreaterThanOrEqual(0.5)
    expect(tracers.x[i]).toBeLessThanOrEqual(WORLD.w - 0.5)
    expect(tracers.y[i]).toBeGreaterThanOrEqual(2)
    expect(tracers.y[i]).toBeLessThanOrEqual(GROUND_Y - 1.5)
    expect(tracers.trailN[i]).toBe(1)
  }
})

test('步进：时钟推进、横向风驱动位移、拖尾按路程采样记录', () => {
  const { fluid, tracers } = build()
  for (let i = 0; i < 120; i++) {
    fluid.step(DT)
    tracers.step(DT, [])
  }
  expect(tracers.time).toBeCloseTo(2, 5)
  let trailed = 0
  for (let i = 0; i < tracers.count; i++) {
    const env = tracers.envelope(i)
    expect(env).toBeGreaterThanOrEqual(0)
    expect(env).toBeLessThanOrEqual(1)
    // 粒子留在边距域内（外扩 6：[-5, 65]），入地即重生不穿地
    expect(tracers.y[i]).toBeLessThanOrEqual(GROUND_Y)
    if (tracers.trailN[i] > 1) trailed++
  }
  // 风速 2 单位/秒 × 2 秒 ≫ 采样距 0.45：绝大多数存活粒子应已记录拖尾
  expect(trailed).toBeGreaterThan(tracers.count / 2)
})

test('热源羽流：源附近持续有新注入粒子', () => {
  const { fluid, tracers } = build()
  const sx = 30
  const sy = GROUND_Y - 4
  for (let i = 0; i < 60; i++) {
    fluid.step(DT)
    tracers.step(DT, [{ x: sx, y: sy }])
  }
  // 末步刚注入的羽流粒子尚未飘远（注入半径 1.6 + 一步位移）：源附近必有粒子
  let near = 0
  for (let i = 0; i < tracers.count; i++) {
    const dx = tracers.x[i] - sx
    const dy = tracers.y[i] - sy
    if (dx * dx + dy * dy < 2.5 * 2.5) near++
  }
  expect(near).toBeGreaterThan(0)
})

test('同种子粒子场逐位一致（确定性随机，同关同场）', () => {
  const a = build()
  const b = build()
  expect(Array.from(b.tracers.x)).toEqual(Array.from(a.tracers.x))
  expect(Array.from(b.tracers.y)).toEqual(Array.from(a.tracers.y))
})

test('count/trailLen 与内核编译期容量不符即抛（无静默回退）', () => {
  const engine = createEngine()
  createFluid(CFG, engine)
  const terrain = bakeTerrain((_x, y) => GROUND_Y - y, WORLD, CFG.cell, 6)
  expect(() => new Tracers(engine, 123, WORLD, terrain, TRAIL_LEN, 6, SEED)).toThrow()
})
