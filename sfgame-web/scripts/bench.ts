/**
 * 无头性能基准 CLI：bun scripts/bench.ts [seconds] [rate]
 * 与浏览器诊断页（bench.html）共用 src/dev/bench-core.ts。
 */
import { runBench } from '../src/dev/bench-core'

const seconds = Number(process.argv[2] ?? 20)
const rate = Number(process.argv[3] ?? 16)

const results = runBench({ seconds, rate })
for (const r of results) {
  console.log(
    `${r.name.padEnd(20)} mean ${r.mean.toFixed(3).padStart(7)} ms  p95 ${r.p95.toFixed(3).padStart(7)} ms  ${r.detail}`,
  )
}
