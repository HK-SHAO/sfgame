// 16x 性能剖析（开发工具，不入库）：测量满速帧的逐项成本分布，找出优化靶点。
// 用法：bun run scripts/profile-16x.ts [level-1.json]
import { readFileSync } from 'node:fs'
import { initEngine } from '../app/wasm/engine.ts'
if (!initEngine(readFileSync('app/wasm/sfengine.wasm'))) throw new Error('WASM 引擎加载失败')
import { levelFromJson, parseLevelText } from '../app/game/level-format.ts'
import { LevelSimulation, FLUID_MARGIN } from '../app/game/simulation.ts'
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

// 放两个源模拟真实对局
sim.placeSource(20, 20, 'hot')
sim.placeSource(40, 18, 'cold')

// 预热 + 让流场成型（60 tick）
for (let i = 0; i < 60; i++) sim.step(1 / 60)

const { w, h, cell } = level.world
const nx = sim.terrain.nx
const ny = sim.terrain.ny
const c = sim.terrain.cell
const viewL = -10
const viewT = -10
const viewR = w + 10
const viewB = h + 10
const i0 = Math.floor(viewL / c + sim.terrain.originX) - 1
const j0 = Math.floor(viewT / c + sim.terrain.originY) - 1
const i1 = Math.ceil(viewR / c + sim.terrain.originX) + 1
const j1 = Math.ceil(viewB / c + sim.terrain.originY) + 1

const N = 200
const acc = {
  simStep: 0, fluidStep: 0, sources: 0, body: 0,
  tracersStep: 0, cloudsStep: 0, trailPush: 0, wind: 0, terrainDraw: 0,
  tracerTess: 0, total: 0,
}
const t0 = performance.now()

function bench(name: keyof typeof acc, fn: () => void) {
  const s = performance.now()
  fn()
  acc[name] += performance.now() - s
}

for (let k = 0; k < N; k++) {
  // —— 单 tick 路径（16x 下每帧 16 tick）——
  bench('sources', () => {
    for (const s of sim.sources) sim.fluid.addHeat(s.x, s.y, s.kind === 'hot' ? 10 / 60 : -10 / 60)
  })
  bench('fluidStep', () => sim.fluid.step(1 / 60))
  bench('body', () => {
    // stepBody 等价内联（含 terrain.sample）
  })
  bench('tracersStep', () => tracers.step(1 / 60, sim.sources))
  bench('cloudsStep', () => clouds.step(1 / 60, sim.fluid))
  bench('trailPush', () => trail.push(sim.plane.x, sim.plane.y, sim.time))
  bench('wind', () => sampleWind(sim.fluid, probes, sim.plane, tmpAir))
  bench('simStep', () => sim.step(1 / 60))
  // —— 每帧一次渲染路径（batch 装配，无 GL）——
  bench('terrainDraw', () => {
    batch.reset()
    batch.terrainDraw(i0, j0, i1, j1)
  })
  bench('tracerTess', () => {
    // 近似 drawTracers 的 JS 循环 + 单次 tessellate
    batch.reset()
    batch.tracers(400, 0.3, 0.3)
  })
}
acc.total = performance.now() - t0
const perFrame16 = (acc.simStep + acc.tracersStep + acc.cloudsStep + acc.trailPush + acc.wind) * 16 +
  acc.terrainDraw + acc.tracerTess
console.log(`关卡 ${level.id} ${level.world.w}×${level.world.h} cell=${cell} 流体网格 ${nx}×${ny} = ${nx * ny} 格`)
console.log(`--- ${N} 轮均摊（单 tick / ms）---`)
for (const k of Object.keys(acc) as (keyof typeof acc)[]) {
  if (k === 'total') continue
  const per = acc[k] / N
  console.log(`${k.padEnd(12)} ${per.toFixed(4)} ms  ${(per / (acc.simStep + acc.tracersStep + acc.cloudsStep + acc.trailPush + acc.wind + acc.simStep) * 100).toFixed(1)}%`)
}
console.log(`--- 16x 单帧估算 ---`)
console.log(`sim(16 tick) ${((acc.simStep) * 16 / N).toFixed(2)} ms  tracers ${(acc.tracersStep * 16 / N).toFixed(2)}  clouds ${(acc.cloudsStep * 16 / N).toFixed(2)}`)
console.log(`tick 总 ${(perFrame16).toFixed(2)} ms/帧 → 理论帧率 ${(1000 / perFrame16).toFixed(1)} fps`)
console.log(`fluid 占 tick 成本 ${(acc.fluidStep / (acc.simStep || 1) * 100).toFixed(0)}%`)
