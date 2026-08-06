import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { evalCandidate, FINE_DT, loadLevel } from './solve-lib'
import { LevelSimulation } from '../src/game/simulation'
import { initWasm, setBackendPref } from '../src/sim/wasm-fluid'

// 后端性能对照：同一关卡同摆法，实测流体 ms/step 与完整通关耗时（一致性 + 加速比一次出）
const file = process.argv[2]
if (!file) {
  console.error('用法：bun run scripts/bench-backend.ts <关卡文件>')
  process.exit(1)
}
const level = loadLevel(file)
const sol = level.json.solutions?.[0]
if (!sol) {
  console.error('关卡文件无注册解，bench 需要可复现摆法')
  process.exit(1)
}
const src = sol.sources.map((s) => [s.x, s.y, s.kind] as [number, number, 'hot' | 'cold'])
const wasmBytes = readFileSync(
  fileURLToPath(new URL('../src/sim/wasm/sfsim.wasm', import.meta.url)),
)

interface Row {
  backend: string
  msPerStep: number
  speedup: number
  winTime: number
  pathLen: number
}

const rows: Row[] = []
let jsMs = 0

for (const backend of ['js', 'wasm'] as const) {
  if (backend === 'js') setBackendPref('js')
  else {
    initWasm(wasmBytes)
    setBackendPref('wasm')
  }
  const sim = new LevelSimulation(level)
  for (const [x, y, k] of src) sim.placeSource(x, y, k)
  const steps = 600
  const t0 = performance.now()
  for (let i = 0; i < steps; i++) sim.step(FINE_DT)
  const ms = (performance.now() - t0) / steps
  if (backend === 'js') jsMs = ms
  const m = evalCandidate(level, src, { dt: FINE_DT, cap: 120 })
  rows.push({
    backend,
    msPerStep: ms,
    speedup: 1,
    winTime: m.won ? m.time : -1,
    pathLen: m.won ? m.pathLen : -1,
  })
}
for (const r of rows) r.speedup = jsMs / r.msPerStep

console.log(`关卡 ${level.id}「${level.name}」 ${level.world.w}×${level.world.h} grid ${level.world.w / level.world.cell | 0}×${level.world.h / level.world.cell | 0}`)
console.log('后端    ms/step   加速比  通关时间  路程')
for (const r of rows) {
  console.log(
    `${r.backend.padEnd(6)} ${r.msPerStep.toFixed(3).padStart(9)} ${r.speedup.toFixed(2).padStart(7)}×  ${r.winTime.toFixed(1).padStart(7)}s ${r.pathLen.toFixed(1).padStart(7)}`,
  )
}
