/**
 * 真实浏览器性能验证（bun scripts/bench-browser.ts）：
 * headless Chrome（CDP 直连，零依赖）加载 bench.html，
 * 按 CPU 节流档位（Emulation.setCPUThrottlingRate）采集各组件帧预算占用，
 * 模拟弱设备下的表现。
 *
 * 用法：bun scripts/bench-browser.ts [节流档位,逗号分隔] [seconds]
 * 例：  bun scripts/bench-browser.ts 1,4,6 5
 *
 * 依赖：本机 Chrome（CHROME_PATH 环境变量可覆盖）；自动拉起 vite dev。
 */
import { existsSync } from 'node:fs'
import { CdpClient } from './cdp-client'

const THROTTLES = (process.argv[2] ?? '1,6').split(',').map(Number)
const SECONDS = Math.max(2, Math.min(60, Number(process.argv[3] ?? 5)))

const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VITE_PORT = 5199
const CDP_PORT = 9333
const USER_DATA = `/tmp/sfgame-bench-chrome-${process.pid}`
// vite 默认只绑 IPv6 回环（::1），必须用 localhost 访问
const BENCH_URL = `http://localhost:${VITE_PORT}/bench.html?seconds=${SECONDS}`

function findChrome(): boolean {
  return existsSync(CHROME)
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

function spawnSilent(cmd: string, args: string[], cwd?: string): { kill: () => void } {
  const proc = Bun.spawn([cmd, ...args], {
    cwd,
    stdout: 'ignore',
    stderr: 'ignore',
  })
  return { kill: () => proc.kill() }
}

async function main() {
  if (!findChrome()) {
    console.error(`未找到 Chrome：${CHROME}（可用 CHROME_PATH 指定）`)
    process.exit(1)
  }
  // 1. vite dev server（直接跑 bin，cwd 必须是项目根——vite 从 cwd 找配置与根目录）
  const vite = spawnSilent(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--port', String(VITE_PORT), '--strictPort'],
    `${import.meta.dir}/..`,
  )
  // 2. headless Chrome（需 --enable-unsafe-swiftshader：headless 默认无 WebGL）
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
    await waitFor(`http://localhost:${VITE_PORT}/`, 20000)
    await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`, 20000)

    const version = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()) as {
      webSocketDebuggerUrl: string
    }
    const browser = await CdpClient.connect(version.webSocketDebuggerUrl)
    const { targetId } = (await browser.send('Target.createTarget', {
      url: 'about:blank',
    })) as { targetId: string }
    const targetWs = `http://127.0.0.1:${CDP_PORT}/devtools/page/${targetId}`
    const page = await CdpClient.connect(targetWs)
    await page.send('Page.enable')
    await page.send('Runtime.enable')

    for (const throttle of THROTTLES) {
      await page.send('Emulation.setCPUThrottlingRate', { rate: throttle })
      await page.send('Page.navigate', { url: BENCH_URL })
      // 等待基准完成（status 文本含「完成」或超时）
      const t0 = Date.now()
      let done = false
      while (Date.now() - t0 < 120000) {
        const status = (await page.evalv('document.getElementById("status")?.textContent ?? ""')) as string
        if (status.includes('完成') || status.includes('Error')) {
          done = status.includes('完成')
          break
        }
        await new Promise((r) => setTimeout(r, 500))
      }
      if (!done) {
        console.log(`\n[${throttle}× 节流] 基准未在 120s 内完成（可能页面错误）`)
        continue
      }
      const report = (await page.evalv('window.__benchReport ?? ""')) as string
      console.log(`\n===== CPU 节流 ${throttle}×（弱设备近似）=====`)
      console.log(report)
      // 留一点间隔避免页面负载叠加
      await new Promise((r) => setTimeout(r, 500))
    }
  } finally {
    chrome.kill()
    vite.kill()
  }
}

void main()
