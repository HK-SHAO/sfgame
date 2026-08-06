// bun 无头流体内核基准（JSC 引擎 ≈ Safari 同源代理）：bun run scripts/bench.ts [--json <path>] [--emcc <path>]
// --emcc：追加 Emscripten 编译版对比（bench/c/build.sh 生成），同规模矩阵输出 asc vs emcc 差值。
// 产物 wasm 缺失/过期先 bun run build:wasm（复用 solve-lib 加载惯例）

import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { initEngine, bootEngine } from '../src/wasm/engine'
import { runBench } from './bench-core'

const wasmPath = `${import.meta.dir}/../src/wasm/sfengine.wasm`
const emccArg = process.argv.indexOf('--emcc')
const emccPath = emccArg >= 0 ? process.argv[emccArg + 1] : undefined
const jsonArg = process.argv.indexOf('--json')
const out = jsonArg >= 0 ? process.argv[jsonArg + 1] : undefined

async function main() {
  const ok = await bootEngine(() => Promise.resolve(readFileSync(wasmPath)))
  if (!ok) throw new Error('WASM 引擎（sfengine.wasm）加载失败，请先 bun run build:wasm')
  const mtime = statSync(wasmPath).mtime.toISOString()

  console.log(`[bench] bun ${Bun.version} · asc wasm ${mtime}`)
  const asc = await runBench()
  console.log(`[bench] asc 完成 · 容量边界 ${asc.capacityRejected ? '✓' : '✗'}`)

  let emcc: Awaited<ReturnType<typeof runBench>> | null = null
  if (emccPath) {
    if (!initEngine(readFileSync(emccPath))) throw new Error(`emcc wasm 加载失败：${emccPath}`)
    console.log(`[bench] emcc wasm ${statSync(emccPath).mtime.toISOString()}（${emccPath}）`)
    emcc = await runBench()
    console.log(`[bench] emcc 完成 · 容量边界 ${emcc.capacityRejected ? '✓' : '✗'}`)
  }

  console.log('[bench] 规模(nx×ny)  地面    格数   asc min   asc med   asc p95   asc格/ms')
  for (const r of asc.rows) {
    console.log(
      `[bench] ${String(r.nx + '×' + r.ny).padEnd(12)} ${r.ground.padEnd(6)} ${String(r.cells).padStart(6)} ` +
        ` ${r.min.toFixed(3).padStart(8)}  ${r.median.toFixed(3).padStart(8)}  ${r.p95.toFixed(3).padStart(8)} ` +
        ` ${r.perMs.toFixed(0).padStart(7)}`,
    )
  }

  if (emcc) {
    console.log('\n=== asc vs emcc 对比（median ms/step） ===')
    console.log(`规模×地面        `.padEnd(16) + 'asc      emcc     diff')
    for (const a of asc.rows) {
      const c = emcc.rows.find((x) => x.nx === a.nx && x.ny === a.ny && x.ground === a.ground)
      if (!c) continue
      const diff = ((c.median - a.median) / a.median) * 100
      const mark = diff <= -3 ? '更快' : diff >= 3 ? '更慢' : '持平'
      console.log(
        `${`${a.nx}×${a.ny} ${a.ground}`.padEnd(16)}` +
          ` ${a.median.toFixed(3).padStart(7)}  ${c.median.toFixed(3).padStart(7)} ` +
          `${(diff >= 0 ? '+' : '') + diff.toFixed(1).padStart(5)}% ${mark}`,
      )
    }
    const aTp = asc.rows.reduce((s, x) => s + x.perMs, 0) / asc.rows.length
    const cTp = emcc.rows.reduce((s, x) => s + x.perMs, 0) / emcc.rows.length
    console.log(`平均吞吐格/ms   ${' '.padEnd(4)} asc ${aTp.toFixed(0).padStart(7)}  emcc ${cTp.toFixed(0).padStart(7)}  ${(((cTp - aTp) / aTp) * 100).toFixed(1)}%`)
  }

  if (out) {
    const payload = {
      meta: { engine: 'bun', bun: Bun.version, ua: `bun/${Bun.version} (JavaScriptCore)`, wasmMtime: mtime, ts: new Date().toISOString() },
      asc,
      emcc,
    }
    writeFileSync(out, JSON.stringify(payload, null, 2))
    console.log(`\n[bench] JSON → ${out}`)
  }
}

await main()
