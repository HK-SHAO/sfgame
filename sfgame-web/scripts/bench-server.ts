// 多浏览器流体内核基准驱动：bun run scripts/bench-server.ts [--port N] [--no-safari]
// 流程：本地 bun 双内核基准（asc + emcc）→ 起静态服务 → 每浏览器串行两轮（?engine=asc 后 ?engine=c）
// → 收齐后按浏览器打印「asc vs emcc」对比表并清理。结果落 bench/results/<browser>-<engine>.json（gitignore）。
// 无头 ≠ 真机：本表为桌面引擎基线；iOS 真机验证按 #7 教训另做。

import { createServer } from 'node:http'
import { spawn, spawnSync, execFile } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { bootEngine, initEngine } from '../src/wasm/engine'
import { runBench } from './bench-core'
import type { BenchRow } from './bench-core'

const root = join(import.meta.dir, '..')
const benchDir = join(root, 'bench')
const wasmPath = join(root, 'src/wasm/sfengine.wasm')
const cWasmPath = join(benchDir, 'c', 'sfengine-c.wasm')
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
type EngineId = 'asc' | 'c'
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

// emcc 产物缺失则自动编译（bench/c/build.sh，需本机 emsdk）
function ensureCWasm(): void {
  if (exists(cWasmPath)) return
  log('emcc 产物缺失，运行 bench/c/build.sh…')
  const r = spawnSync('sh', [join(benchDir, 'c', 'build.sh')], { cwd: benchDir })
  if (r.status !== 0 || !exists(cWasmPath)) {
    throw new Error(`emcc 产物构建失败：${r.stderr?.toString() ?? '未知'}`)
  }
}

// ---------- 1. 本地 bun 双内核基准（同一测量核心） ----------
buildBundle()
ensureCWasm()
log(`本地基准（bun ${Bun.version}，JSC ≈ Safari 引擎代理）…`)
{
  const ascBytes = readFileSync(wasmPath)
  if (!(await bootEngine(() => Promise.resolve(ascBytes)))) throw new Error('WASM 引擎加载失败，请先 bun run build:wasm')
  const asc = await runBench()
  mkdirSync(resultsDir, { recursive: true })
  writeFileSync(join(resultsDir, 'bun-asc.json'), JSON.stringify({ meta: { engine: 'bun', kernel: 'asc', bun: Bun.version, ua: `bun/${Bun.version} (JavaScriptCore)`, wasmMtime: statSync(wasmPath).mtime.toISOString(), ts: new Date().toISOString() }, ...asc }, null, 2))
  received.add('bun-asc')
  state.set('bun-asc', 'ok')
  log(`bun asc 完成（容量边界 ${asc.capacityRejected ? '✓' : '✗'}）→ results/bun-asc.json`)
}
{
  if (!initEngine(readFileSync(cWasmPath))) throw new Error('emcc wasm 加载失败')
  const c = await runBench()
  writeFileSync(join(resultsDir, 'bun-c.json'), JSON.stringify({ meta: { engine: 'bun', kernel: 'c', bun: Bun.version, ua: `bun/${Bun.version} (JavaScriptCore)`, wasmMtime: statSync(cWasmPath).mtime.toISOString(), ts: new Date().toISOString() }, ...c }, null, 2))
  received.add('bun-c')
  state.set('bun-c', 'ok')
  log(`bun c 完成（容量边界 ${c.capacityRejected ? '✓' : '✗'}）→ results/bun-c.json`)
}
// 恢复 asc 模块（供其他脚本逻辑继续）
initEngine(readFileSync(wasmPath))

// ---------- 2. HTTP 静态服务 + /collect ----------
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (url.pathname === '/collect' && req.method === 'POST') {
    let body = ''
    req.on('data', (cc) => (body += cc))
    req.on('end', () => {
      const b = url.searchParams.get('browser')
      const e = url.searchParams.get('engine')
      if (!b || !e) {
        res.writeHead(400, { 'Content-Type': 'text/plain' }).end('missing browser/engine')
        return
      }
      const key = `${b}-${e}`
      try {
        const j = JSON.parse(body)
        writeFileSync(join(resultsDir, `${key}.json`), JSON.stringify(j, null, 2))
        received.add(key)
        state.set(key, 'ok')
        log(`收到 ${key}（${j.rows?.length ?? 0} 行）→ results/${key}.json`)
        res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok')
        kick(b as BrowserId)
        checkDone()
      } catch (err) {
        if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end(`bad json: ${String(err)}`)
      }
    })
    return
  }
  if (res.headersSent) return
  // 静态：/bench.html、/bundle.js、/sfengine.wasm（bench/）、/c/*（bench/c/）
  const name = url.pathname === '/' ? '/bench.html' : url.pathname
  const file = name.startsWith('/c/') ? join(benchDir, name.slice(1)) : join(benchDir, name)
  if (exists(file) && file.startsWith(benchDir)) {
    const ext = file.slice(file.lastIndexOf('.'))
    const ct = ext === '.wasm' ? 'application/wasm' : ext === '.js' ? 'text/javascript' : 'text/html'
    res.writeHead(200, { 'Content-Type': ct }).end(readFileSync(file))
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found')
  }
})

// ---------- 3. 浏览器检测与驱动（每浏览器串行 asc → c） ----------
function spawnEngine(b: BrowserId, e: EngineId): void {
  const key = `${b}-${e}`
  if (spawned.has(key)) return
  spawned.add(key)
  const url = `http://127.0.0.1:${port}/bench.html?browser=${b}&engine=${e}`
  if (b === 'chrome') {
    const child = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=/tmp/bench-chrome-${Date.now()}-${e}`, url], { stdio: 'ignore' })
    children.push(child)
  } else if (b === 'firefox') {
    const child = spawn(FIREFOX, ['--headless', '--new-instance', '--no-remote', `--profile`, `/tmp/bench-firefox-${Date.now()}-${e}`, url], { stdio: 'ignore' })
    children.push(child)
  } else if (b === 'safari') {
    execFile('open', ['-a', 'Safari', url], (err) => {
      if (err) {
        state.set(key, 'fail')
        log(`Safari 启动失败：${err.message}`)
      }
    })
  }
  log(`驱动 ${b}（${e}）`)
}

function kick(b: BrowserId): void {
  if (!expected.has(`${b}-asc`) && !expected.has(`${b}-c`)) return
  if (received.has(`${b}-asc`)) spawnEngine(b, 'c')
  else spawnEngine(b, 'asc')
}

function detect(): void {
  if (exists(CHROME)) {
    expected.add('chrome-asc'); expected.add('chrome-c')
    kick('chrome')
  } else {
    state.set('chrome-asc', 'skipped')
    log('Chrome 未安装，跳过')
  }
  if (exists(FIREFOX)) {
    expected.add('firefox-asc'); expected.add('firefox-c')
    kick('firefox')
  } else {
    state.set('firefox-asc', 'skipped')
    log('Firefox 未安装，跳过')
  }
  if (!noSafari) {
    expected.add('safari-asc'); expected.add('safari-c')
    kick('safari')
  } else {
    state.set('safari-asc', 'skipped')
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

// ---------- 5. 汇总对比表（每浏览器 asc vs c） ----------
function loadRows(b: BrowserId, e: EngineId): BenchRow[] | null {
  const p = join(resultsDir, `${b}-${e}.json`)
  if (!exists(p)) return null
  try {
    return (JSON.parse(readFileSync(p, 'utf8')) as { rows: BenchRow[] }).rows
  } catch {
    return null
  }
}

function printSummary(): void {
  const active = BROWSER_ORDER.filter((b) => loadRows(b, 'asc') && loadRows(b, 'c'))
  if (active.length === 0) return
  for (const b of active) {
    const asc = loadRows(b, 'asc')!
    const c = loadRows(b, 'c')!
    console.log(`\n=== ${b}：asc vs emcc（median ms/step） ===`)
    console.log(`规模×地面        `.padEnd(16) + 'asc      emcc     diff')
    for (const a of asc) {
      const cw = c.find((x) => x.nx === a.nx && x.ny === a.ny && x.ground === a.ground)
      if (!cw) continue
      const diff = ((cw.median - a.median) / a.median) * 100
      const mark = diff <= -3 ? '更快' : diff >= 3 ? '更慢' : '持平'
      console.log(
        `${`${a.nx}×${a.ny} ${a.ground}`.padEnd(16)}` +
          ` ${a.median.toFixed(3).padStart(7)}  ${cw.median.toFixed(3).padStart(7)} ` +
          `${(diff >= 0 ? '+' : '') + diff.toFixed(1).padStart(5)}% ${mark}`,
      )
    }
    const aTp = asc.reduce((s, x) => s + x.perMs, 0) / asc.length
    const cTp = c.reduce((s, x) => s + x.perMs, 0) / c.length
    console.log(`平均吞吐格/ms     ${' '.padEnd(7)} asc ${aTp.toFixed(0).padStart(7)}  emcc ${cTp.toFixed(0).padStart(7)}  ${(((cTp - aTp) / aTp) * 100).toFixed(1)}%`)
    const j = JSON.parse(readFileSync(join(resultsDir, `${b}-asc.json`), 'utf8'))
    const jc = JSON.parse(readFileSync(join(resultsDir, `${b}-c.json`), 'utf8'))
    console.log(`— ${b}: ${j.meta.ua ?? j.meta.engine} · asc wasm ${j.meta.wasmMtime} / emcc wasm ${jc.meta.wasmMtime} · 容量边界 ${j.capacityRejected && jc.capacityRejected ? '✓' : '✗'}`)
  }
}

// ---------- 启动 ----------
server.listen(port, '127.0.0.1', () => {
  log(`服务 http://127.0.0.1:${port}/bench.html（结果目录 bench/results/）`)
  detect()
  setInterval(pollTimeout, 5_000).unref()
  checkDone()
})
