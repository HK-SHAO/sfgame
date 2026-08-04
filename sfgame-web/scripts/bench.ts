/**
 * 无头性能基准 CLI：bun scripts/bench.ts [seconds] [wasm]
 * 与浏览器诊断页（bench.html）共用 src/dev/bench-core.ts。
 */
import { ensureWasmFluid, runBench } from '../src/dev/bench-core'

const seconds = Number(process.argv[2] ?? 20)
const includeWasm = process.argv[3] === 'wasm'

if (includeWasm) {
  const ok = await ensureWasmFluid()
  if (!ok) console.log('（wasm 求解器不可用，跳过对比）')
}

const results = runBench({ seconds, includeWasm })
for (const r of results) {
  console.log(
    `${r.name.padEnd(20)} mean ${r.mean.toFixed(3).padStart(7)} ms  p95 ${r.p95.toFixed(3).padStart(7)} ms  ${r.detail}`,
  )
}
