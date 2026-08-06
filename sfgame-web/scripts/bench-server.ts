// 多浏览器流体内核基准驱动：bun run scripts/bench-server.ts [--port N] [--no-safari]
// 流程：本地 bun 基准 → 起静态服务（bench/ 目录）→ 驱动 Chrome/Firefox/Safari（页面自驱动 POST /collect）
// → 收齐后打印「规模 × 浏览器」对比表并清理浏览器进程。结果 JSON 落 bench/results/<browser>.json（gitignore）。
// 无头 ≠ 真机：本表为桌面引擎基线；iOS 真机验证按 #7 教训另做。

import { createServer } from 'node:http'
import { spawn, spawnSync, execFile } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { bootEngine } from '../src/wasm/engine'
import { runBench } from './bench-core'
import type { BenchRow } from './bench-core'

const root = join(import.meta.dir, '..')
const benchDir = join(root, 'bench')
const wasmPath = join(root, 'src/wasm/sfengine.wasm')
const resultsDir = join(benchDir, 'results')
const bundlePath = join(benchDir, 'bundle.js')
const benchWasmPath = join(benchDir, 'sfengine.wasm')

const args = process.argv.slice(2)
const portArg = args.indexOf('--port')
const port = portArg >= 0 ? Number(args[portArg + 1]) : 8471
const noSafari = args.includes('--no-safari')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const FIREFOX = '/Applications/Firefox.app/Contents/MacOS/firefox'

type BrowserId = 'bun' | 'chrome' | 'firefox' | 'safari'
const BROWSER_ORDER: BrowserId[] = ['bun', 'chrome', 'firefox', 'safari']

const received = new Set<string>()
const expected = new Set<string>()
const spawned = new Set<string>()
const state = new Map<string, 'ok' | 'timeout' | 'skipped' | 'fail'>()
const children: ReturnType<typeof spawn>[] = []

function log(s: string) {
  console.log(`[bench-server] ${s}`)
}

function exists(p: string): boolean {
  return existsSync(p)
}

// ---------- 0. 浏览器产物自动构建（bench-core/page 或 wasm 变化即重建） ----------
function buildBundle(): void {
  const srcs = [join(import.meta.dir, 'bench-core.ts'), join(import.meta.dir, 'bench-page.ts'), join(benchDir, 'bench.html')]
  const stale =
    !exists(bundlePath) ||
    !exists(benchWasmPath) ||
    srcs.some((s) => statSync(s).mtimeMs > statSync(bundlePath).mtimeMs) ||
    statSync(wasmPath).mtimeMs > statSync(benchWasmPath).mtimeMs
  if (stale) {
    log('重建浏览器产物（源码/产物过期）…')
    const r = spawnSync('bun', ['build', 'scripts/bench-page.ts', '--outfile', 'bench/bundle.js', '--target', 'browser', '--format', 'iife'], { cwd: root })
    if (r.status !== 0) throw new Error(`bundle 构建失败：${r.stderr?.toString() ?? ''}`)
    copyFileSync(wasmPath, benchWasmPath)
  }
}

// ---------- 1. 本地 bun 基准（同一测量核心） ----------
buildBundle()
log(`本地基准（bun ${Bun.version}，JSC ≈ Safari 引擎代理）…`)
{
  const ascBytes = readFileSync(wasmPath)
  if (!(await bootEngine(() => Promise.resolve(ascBytes)))) throw new Error('WASM 引擎加载失败，请先 bun run build:wasm')
  const res = await runBench()
  mkdirSync(resultsDir, { recursive: true })
  writeFileSync(join(resultsDir, 'bun.json'), JSON.stringify({ meta: { engine: 'bun', bun: Bun.version, ua: `bun/${Bun.version} (JavaScriptCore)`, wasmMtime: statSync(wasmPath).mtime.toISOString(), ts: new Date().toISOString() }, ...res }, null, 2))
  received.add('bun')
  state.set('bun', 'ok')
  log(`bun 完成（容量边界 ${res.capacityRejected ? '✓' : '✗'}）→ results/bun.json`)
}

// ---------- 2. HTTP 静态服务 + /collect ----------
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (url.pathname === '/collect' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const b = url.searchParams.get('browser')
      if (!b) {
        res.writeHead(400, { 'Content-Type': 'text/plain' }).end('missing browser')
        return
      }
      try {
        const j = JSON.parse(body)
        writeFileSync(join(resultsDir, `${b}.json`), JSON.stringify(j, null, 2))
        received.add(b)
        state.set(b, 'ok')
        log(`收到 ${b} 结果（${j.rows?.length ?? 0} 行）→ results/${b}.json`)
        res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok')
        checkDone()
      } catch (err) {
        if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end(`bad json: ${String(err)}`)
      }
    })
    return
  }
  if (res.headersSent) return
  const name = url.pathname === '/' ? '/bench.html' : url.pathname
  const file = join(benchDir, name)
  if (exists(file) && file.startsWith(benchDir)) {
    const ext = file.slice(file.lastIndexOf('.'))
    const ct = ext === '.wasm' ? 'application/wasm' : ext === '.js' ? 'text/javascript' : 'text/html'
    res.writeHead(200, { 'Content-Type': ct }).end(readFileSync(file))
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found')
  }
})

// ---------- 3. 浏览器检测与驱动 ----------
function spawnBrowser(b: BrowserId): void {
  if (spawned.has(b)) return
  spawned.add(b)
  const url = `http://127.0.0.1:${port}/bench.html?browser=${b}`
  if (b === 'chrome') {
    const child = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=/tmp/bench-chrome-${Date.now()}`, url], { stdio: 'ignore' })
    children.push(child)
  } else if (b === 'firefox') {
    const child = spawn(FIREFOX, ['--headless', '--new-instance', '--no-remote', '--profile', `/tmp/bench-firefox-${Date.now()}`, url], { stdio: 'ignore' })
    children.push(child)
  } else if (b === 'safari') {
    execFile('open', ['-a', 'Safari', url], (err) => {
      if (err) {
        state.set(b, 'fail')
        log(`Safari 启动失败：${err.message}`)
      }
    })
  }
  log(`驱动 ${b}`)
}

function detect(): void {
  if (exists(CHROME)) {
    expected.add('chrome')
    spawnBrowser('chrome')
  } else {
    state.set('chrome', 'skipped')
    log('Chrome 未安装，跳过')
  }
  if (exists(FIREFOX)) {
    expected.add('firefox')
    spawnBrowser('firefox')
  } else {
    state.set('firefox', 'skipped')
    log('Firefox 未安装，跳过')
  }
  if (!noSafari) {
    expected.add('safari')
    spawnBrowser('safari')
  } else {
    state.set('safari', 'skipped')
  }
}

// ---------- 4. 收齐判定 / 超时 / 清理 ----------
const started = Date.now()
const TIMEOUT_MS = 420_000

function killBrowsers(): void {
  for (const c of children) c.kill('SIGKILL')
  if (!noSafari) {
    spawn('osascript', ['-e', 'tell application "Safari" to quit'], { stdio: 'ignore' }).unref()
  }
}

let finished = false
function finish(code: number): void {
  if (finished) return
  finished = true
  killBrowsers()
  server.close()
  try {
    printSummary()
  } catch (e) {
    console.error('[bench-server] 汇总失败：', e)
  }
  // 自然退出（stdout 管道 flush）；3s 兜底防残留句柄挂死
  setTimeout(() => process.exit(code), 3000).unref()
}

function allSettled(): boolean {
  for (const k of expected) if (!received.has(k) && state.get(k) !== 'timeout') return false
  return true
}

function checkDone(): void {
  if (allSettled()) {
    log('全部浏览器已收齐')
    finish(0)
  }
}

function pollTimeout(): void {
  if (Date.now() - started >= TIMEOUT_MS) {
    for (const k of expected) {
      if (!received.has(k) && state.get(k) !== 'skipped' && state.get(k) !== 'fail') {
        state.set(k, 'timeout')
        log(`${k} 超时（${TIMEOUT_MS / 1000}s），标记 timeout`)
      }
    }
    log('超时收尾')
    finish(allSettled() ? 0 : 1)
  }
}

// ---------- 5. 汇总对比表 ----------
function loadRows(b: BrowserId): BenchRow[] | null {
  const p = join(resultsDir, `${b}.json`)
  if (!exists(p)) return null
  try {
    return (JSON.parse(readFileSync(p, 'utf8')) as { rows: BenchRow[] }).rows
  } catch {
    return null
  }
}

function printSummary(): void {
  const active = BROWSER_ORDER.filter((b) => loadRows(b) !== null)
  if (active.length === 0) return
  const header = `规模×地面        `.padEnd(16) + active.map((b) => `${b}${state.get(b) === 'timeout' ? '!' : ''}`.padEnd(10)).join('')
  console.log(`\n=== 规模 × 浏览器对比表（median ms/step） ===`)
  console.log(header)
  const ref = loadRows(active[0])!
  for (const r of ref) {
    const cells = active.map((b) => {
      const row = loadRows(b)?.find((x) => x.nx === r.nx && x.ny === r.ny && x.ground === r.ground)
      return row ? row.median.toFixed(3) : '—'
    })
    console.log(`${`${r.nx}×${r.ny} ${r.ground}`.padEnd(16)}` + cells.map((c) => c.padStart(9)).join(''))
  }
  const tp = active.map((b) => {
    const rows = loadRows(b)
    const avg = rows ? (rows.reduce((s, x) => s + x.perMs, 0) / rows.length).toFixed(0) : '—'
    return avg.padStart(9)
  })
  console.log(`平均吞吐格/ms `.padEnd(16) + tp.join(''))
  for (const b of active) {
    const j = JSON.parse(readFileSync(join(resultsDir, `${b}.json`), 'utf8'))
    console.log(`— ${b}: ${j.meta.ua ?? j.meta.engine}${j.meta.wasmMtime ? ` · wasm ${j.meta.wasmMtime}` : ''} · 容量边界 ${j.capacityRejected ? '✓' : '✗'}`)
  }
}

// ---------- 启动 ----------
server.listen(port, '127.0.0.1', () => {
  log(`服务 http://127.0.0.1:${port}/bench.html（结果目录 bench/results/）`)
  detect()
  setInterval(pollTimeout, 5_000).unref()
  checkDone()
})
