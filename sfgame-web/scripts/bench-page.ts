// 浏览器端基准入口（bun build --target=browser 打包为 iife bundle，bench.html 引用）：
// 加载同一 sfengine.wasm → 跑 bench-core 同一测量 → POST /collect 回传，页面自驱动无需 WebDriver

import { bootEngine } from '../src/wasm/engine'
import { runBench } from './bench-core'

const browser = new URLSearchParams(location.search).get('browser') ?? 'unknown'
const engine = new URLSearchParams(location.search).get('engine') ?? 'asc'
const wasmUrl = engine === 'c' ? 'c/sfengine-c.wasm' : 'sfengine.wasm'
const out = document.getElementById('out') as HTMLPreElement

function log(s: string) {
  out.textContent += s + '\n'
  console.log('[bench]', s)
}

async function main(): Promise<void> {
  log(`引擎：${browser} · 内核：${engine} · ${navigator.userAgent}`)
  const ok = await bootEngine(async () => {
    const res = await fetch(wasmUrl)
    if (!res.ok) throw new Error(`${wasmUrl} ${res.status}`)
    return res.arrayBuffer()
  })
  if (!ok) {
    log('WASM 加载失败')
    return
  }
  log('wasm 已加载，开始测量…')
  const { rows, capacityRejected } = await runBench((r, i) => log(`  ${i + 1}/16 ${r.nx}×${r.ny} ${r.ground} → median ${r.median.toFixed(3)}ms`))
  log(`容量边界 161×121 拒绝：${capacityRejected ? '✓' : '✗'}`)
  const payload = {
    meta: { engine: browser, kernel: engine, ua: navigator.userAgent, ts: new Date().toISOString() },
    rows,
    capacityRejected,
  }
  const res = await fetch(`/collect?browser=${encodeURIComponent(browser)}&engine=${encodeURIComponent(engine)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  log(`回传结果：${res.ok ? (await res.text()) : `HTTP ${res.status}`}`)
  document.title = 'BENCH-DONE'
}

main().catch((e) => {
  out.textContent += `\n失败：${String(e)}\n`
  console.error(e)
})
