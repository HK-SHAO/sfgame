// bun 无头流体内核基准（JSC 引擎 ≈ Safari 同源代理）：bun run scripts/bench.ts [--json <path>]
// 产物 wasm 缺失/过期先 bun run build:wasm（复用 solve-lib 加载惯例）

import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { bootEngine } from '../src/wasm/engine'
import { runBench } from './bench-core'

const wasmPath = `${import.meta.dir}/../src/wasm/sfengine.wasm`
const jsonArg = process.argv.indexOf('--json')
const out = jsonArg >= 0 ? process.argv[jsonArg + 1] : undefined

async function main() {
  const ok = await bootEngine(() => Promise.resolve(readFileSync(wasmPath)))
  if (!ok) throw new Error('WASM 引擎（sfengine.wasm）加载失败，请先 bun run build:wasm')
  const mtime = statSync(wasmPath).mtime.toISOString()

  console.log(`[bench] bun ${Bun.version} · wasm ${mtime}`)
  const { rows, capacityRejected } = await runBench()
  console.log('[bench] 规模(nx×ny)  地面    格数   min(ms)  median  p95    格/ms   步数')
  for (const r of rows) {
    console.log(
      `[bench] ${String(r.nx + '×' + r.ny).padEnd(12)} ${r.ground.padEnd(6)} ${String(r.cells).padStart(6)} ` +
        ` ${r.min.toFixed(3).padStart(7)}  ${r.median.toFixed(3).padStart(7)}  ${r.p95.toFixed(3).padStart(7)} ` +
        ` ${r.perMs.toFixed(0).padStart(6)}  ${r.steps}`,
    )
  }
  console.log(`[bench] 容量边界 161×121 拒绝创建：${capacityRejected ? '✓' : '✗ 意外接受'}`)

  if (out) {
    writeFileSync(out, JSON.stringify({ meta: { engine: 'bun', bun: Bun.version, ua: `bun/${Bun.version} (JavaScriptCore)`, wasmMtime: mtime, ts: new Date().toISOString() }, rows, capacityRejected }, null, 2))
    console.log(`[bench] JSON → ${out}`)
  }
}

await main()
