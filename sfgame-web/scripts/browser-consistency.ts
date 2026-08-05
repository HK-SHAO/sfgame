/**
 * 无头仿真 ↔ 真实浏览器一致性验证：
 * 每个关卡每个参考答案，在 headless Chrome 里跑真实游戏（?dev=1&lv=N&src=…），
 * 读取 dev 钩子的模拟时钟（通关冻结值），与 bun 无头结果比对（容差 ±0.6s）。
 * 同时抽查无操作不通关（挂机 15s）。
 *
 * 用法：bun run scripts/browser-consistency.ts
 * 依赖：本机 Chrome（CHROME_PATH 可覆盖）。自动拉起 vite dev。
 */
import { existsSync, readFileSync } from 'node:fs'
import { parseLevelText } from '../src/game/level-format'
import { sourceItem } from '../src/game/state'

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VITE_PORT = 5201
const CDP_PORT = 9335
const USER_DATA = `/tmp/sfgame-consistency-chrome-${process.pid}`
const BASE = `http://localhost:${VITE_PORT}`
const TOLERANCE = 0.6

class CdpClient {
  private ws: WebSocket
  private id = 0
  private pending = new Map<number, (v: unknown) => void>()

  private constructor(ws: WebSocket) {
    this.ws = ws
  }

  static async connect(wsUrl: string): Promise<CdpClient> {
    const ws = new WebSocket(wsUrl)
    await new Promise<void>((res, rej) => {
      ws.onopen = () => res()
      ws.onerror = () => rej(new Error('CDP WebSocket 连接失败'))
    })
    const c = new CdpClient(ws)
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data))
      if (msg.id && c.pending.has(msg.id)) {
        c.pending.get(msg.id)!(msg.result ?? msg.error)
        c.pending.delete(msg.id)
      }
    }
    return c
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, (v) => (v && (v as { message?: string }).message ? reject(v) : resolve(v)))
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async evalv(expression: string): Promise<unknown> {
    const r = (await this.send('Runtime.evaluate', { expression, returnByValue: true })) as {
      result?: { value?: unknown }
    }
    return r.result?.value
  }
}

function spawnSilent(cmd: string, args: string[], cwd?: string): { kill: () => void } {
  const proc = Bun.spawn([cmd, ...args], { cwd, stdout: 'ignore', stderr: 'ignore' })
  return { kill: () => proc.kill() }
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const t0 = Date.now()
  let lastErr = ''
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url)
      if (r.ok) return
      lastErr = `status ${r.status}`
    } catch (e) {
      lastErr = (e as Error).message
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`等待 ${url} 超时（${lastErr}）`)
}

async function main() {
  if (!existsSync(CHROME)) {
    console.error(`未找到 Chrome：${CHROME}（可用 CHROME_PATH 指定）`)
    process.exit(1)
  }
  const vite = spawnSilent(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(VITE_PORT), '--strictPort'], `${import.meta.dir}/..`)
  const chrome = spawnSilent(CHROME, [
    '--headless=new',
    '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${USER_DATA}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ])
  try {
    await waitFor(`${BASE}/`, 15000)
    await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`, 15000)
    const ver = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()) as { webSocketDebuggerUrl: string }
    const browser = await CdpClient.connect(ver.webSocketDebuggerUrl)
    const { targetId } = (await browser.send('Target.createTarget', { url: 'about:blank' })) as { targetId: string }
    const cdp = await CdpClient.connect(`http://127.0.0.1:${CDP_PORT}/devtools/page/${targetId}`)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')

    let failed = 0
    for (const n of [1, 2, 3, 4, 5]) {
      const j = parseLevelText(readFileSync(`./levels/level-${n}.yaml`, 'utf8')) as unknown as {
        goals: unknown[]
        solutions?: Array<{ name: string; sources: Array<{ x: number; y: number; kind: 'hot' | 'cold' }>; winTime: number }>
      }
      for (const sol of j.solutions ?? []) {
        const src = sol.sources.map((s) => sourceItem.encode(s)).join('_')
        await cdp.send('Page.navigate', { url: `${BASE}/?dev=1&lv=${n}&src=${src}` })
        const t0 = Date.now()
        let won = false
        let simTime = -1
        while (Date.now() - t0 < 45000) {
          const state = (await cdp.evalv(
            `(() => { const g = window.__sfgame; return g ? { phase: g.hud().phase, time: g.hud().time } : null })()`,
          )) as { phase: string; time: number } | null
          if (state?.phase === 'won') {
            won = true
            simTime = state.time
            break
          }
          await new Promise((r) => setTimeout(r, 120))
        }
        const diff = won ? Math.abs(simTime - sol.winTime) : Infinity
        const ok = won && diff <= TOLERANCE
        if (!ok) failed++
        console.log(
          `L${n}「${sol.name}」${ok ? '✓' : '✗'} 浏览器 ${won ? `${simTime.toFixed(1)}s` : '未通关'} | 无头 ${sol.winTime}s | 差 ${won ? diff.toFixed(2) : '-'}s`,
        )
      }
      // 无操作挂机 15s：不得通关
      await cdp.send('Page.navigate', { url: `${BASE}/?dev=1&lv=${n}` })
      await new Promise((r) => setTimeout(r, 500))
      const t1 = Date.now()
      let idleWon = false
      while (Date.now() - t1 < 15000) {
        const state = (await cdp.evalv(
          `(() => { const g = window.__sfgame; return g ? g.hud().phase : null })()`,
        )) as string | null
        if (state === 'won') {
          idleWon = true
          break
        }
        await new Promise((r) => setTimeout(r, 200))
      }
      if (idleWon) {
        failed++
        console.log(`L${n} 无操作挂机 15s：✗ 意外通关`)
      } else {
        console.log(`L${n} 无操作挂机 15s：✓ 未通关`)
      }
    }
    console.log(failed === 0 ? '\n全部一致 ✓' : `\n${failed} 项不一致 ✗`)
    process.exit(failed === 0 ? 0 : 1)
  } finally {
    chrome.kill()
    vite.kill()
  }
}

await main()
