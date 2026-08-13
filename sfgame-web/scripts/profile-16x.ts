// 16x 性能剖析（开发工具）：测量满速帧的逐项成本分布，找优化靶点。
// 用法：bun run scripts/profile-16x.ts [levels/level-1.json]
import { readFileSync } from 'node:fs'
import { initEngine } from '../app/wasm/engine.ts'
if (!initEngine(readFileSync('app/wasm/sfengine.wasm'))) throw new Error('WASM 引擎加载失败')
import { levelFromJson, parseLevelText } from '../app/game/level-format.ts'
import { LevelSimulation } from '../app/game/simulation.ts'
import { FLUID_MARGIN } from '../app/sim/terrain.ts'
import { Tracers, TRAIL_LEN } from '../app/sim/particles.ts'
import { Clouds } from '../app/sim/clouds.ts'
import { Trail } from '../app/sim/trail.ts'
import { buildWindProbes, sampleWind } from '../app/core/wind.ts'
import { createEngine } from '../app/wasm/engine.ts'
import { levelSeed } from '../app/game/levels.ts'
import { MeshBatch } from '../app/render/batch.ts'

const file = process.argv[2] ?? 'levels/level-1.json'
const level = levelFromJson(parseLevelText(readFileSync(file, 'utf8')), true)

const engine = createEngine()
const sim = new LevelSimulation(level, engine)
const tracers = new Tracers(engine, 400, level.world, sim.terrain, TRAIL_LEN, FLUID_MARGIN, levelSeed(level.id, 0x85ebca6b))
const clouds = new Clouds(levelSeed(level.id), level.world, sim.terrain)
const trail = new Trail(150, 0.3, 6)
const probes = buildWindProbes(level.world.w, level.world.h)
const tmpAir = { x: 0, y: 0 }
const batch = new MeshBatch(engine)

sim.placeSource(20, 20, 'hot')
sim.placeSource(40, 18, 'cold')
for (let i = 0; i < 60; i++) sim.step(1 / 60) // 预热让流场成型

const { w, h, cell } = level.world
const c = sim.terrain.cell
const i0 = Math.floor(-10 / c + sim.terrain.originX) - 1
const j0 = Math.floor(-10 / c + sim.terrain.originY) - 1
const i1 = Math.ceil((w + 10) / c + sim.terrain.originX) + 1
const j1 = Math.ceil((h + 10) / c + sim.terrain.originY) + 1

const N = 200
const acc: Record<string, number> = { simStep: 0, tracersStep: 0, cloudsStep: 0, trailPush: 0, wind: 0, tracerTess: 0 }
const bench = (name: string, fn: () => void) => {
  const s = performance.now()
  fn()
  acc[name] += performance.now() - s
}

// 地形烘焙一次（静态几何，视域变化才重烘，不进每帧循环）
batch.terrainSetup(
  sim.terrain.nx, sim.terrain.ny, -sim.terrain.originX * sim.terrain.cell, -sim.terrain.originY * sim.terrain.cell, sim.terrain.cell,
  0.85, 0.76, 0.58, 0.93, 0.86, 0.73, 8,
)
batch.terrainField.set(sim.terrain.field)
const bakeT0 = performance.now()
const terrainVerts = batch.terrainBake(i0, j0, i1, j1)
const bakeMs = performance.now() - bakeT0

for (let k = 0; k < N; k++) {
  // —— 每 tick（16x 下每帧 16 tick）——
  bench('simStep', () => sim.step(1 / 60))
  bench('tracersStep', () => tracers.step(1 / 60, sim.sources))
  bench('cloudsStep', () => clouds.step(1 / 60, sim.fluid))
  bench('trailPush', () => trail.push(sim.plane.x, sim.plane.y, sim.time))
  bench('wind', () => sampleWind(sim.fluid, probes, sim.plane, tmpAir))
  // —— 每帧一次渲染批（无 GL）——
  bench('tracerTess', () => {
    batch.reset()
    batch.tracers(400, 0.3, 0.3)
  })
}

// fluid 单独微基准（不进 tick 循环，避免与 simStep 重复调用混淆）
const FLUID_N = 500
const fs = performance.now()
for (let k = 0; k < FLUID_N; k++) sim.fluid.step(1 / 60)
const fluidMs = (performance.now() - fs) / FLUID_N

const tickTotal = (acc.simStep + acc.tracersStep + acc.cloudsStep + acc.trailPush + acc.wind) / N
const frame16 = tickTotal * 16 + acc.tracerTess / N
console.log(`关卡 ${level.id} ${w}×${h} cell=${cell} 流体网格 ${sim.terrain.nx}×${sim.terrain.ny}`)
console.log(`--- 单 tick / ms（合计 ${tickTotal.toFixed(4)}）---`)
for (const [k, ms] of Object.entries(acc)) {
  console.log(`${k.padEnd(12)} ${(ms / N).toFixed(4)}  ${((ms / N / tickTotal) * 100).toFixed(1)}%`)
}
console.log(`fluidStep（单独基准） ${fluidMs.toFixed(4)} ms  ≈ sim.step 的 ${((fluidMs / (acc.simStep / N)) * 100).toFixed(0)}%`)
console.log(`地形烘焙 ${terrainVerts} 顶点 ${bakeMs.toFixed(2)} ms（静态，每帧免重切）`)
console.log(`--- 16x 单帧估算（16 tick + 1 帧渲染批，不含 GL/让出）---`)
console.log(`帧成本 ${frame16.toFixed(2)} ms → 理论帧率 ${(1000 / frame16).toFixed(1)} fps`)
