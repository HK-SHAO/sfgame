// E2E 冒烟：CDP 驱动无头 Chrome，进入第 1 关、轻点放热源、截图验证。
import { writeFileSync } from 'node:fs'

const PORT = 9223

async function main() {
  const list = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()) as Array<{
    type: string
    webSocketDebuggerUrl: string
  }>
  const page = list.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map<number, (v: any) => void>()
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data))
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)!(msg)
      pending.delete(msg.id)
    }
  })
  await new Promise((r) => ws.addEventListener('open', () => r(null), { once: true }))
  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<any>((resolve) => {
      const mid = ++id
      pending.set(mid, resolve)
      ws.send(JSON.stringify({ id: mid, method, params }))
    })
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const evalJs = async (expression: string) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    return res.result?.result?.value
  }
  const click = async (x: number, y: number, holdMs = 0) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    if (holdMs > 0) await sleep(holdMs)
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await sleep(1500)

  const btn = await evalJs(`(() => {
    const el = document.querySelector('sf-app').shadowRoot.querySelector('.level.play')
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })()`)
  console.log('level button at', JSON.stringify(btn))
  await click(btn.x, btn.y)
  await sleep(1000)

  const worldToScreen = `(wx, wy) => {
    const canvas = document.querySelector('sf-app').shadowRoot.querySelector('canvas')
    const r = canvas.getBoundingClientRect()
    const w = 76, h = 56
    const s = Math.min(r.width / w, r.height / h)
    const ox = (r.width - w * s) / 2
    const oy = (r.height - h * s) / 2
    return { x: r.x + ox + wx * s, y: r.y + oy + wy * s }
  }`

  // 轻点飞机脚下 → 热源（吸附贴地）
  const tap = await evalJs(`(${worldToScreen})(16, 47.5)`)
  console.log('tap at', JSON.stringify(tap))
  await click(tap.x, tap.y)
  await sleep(400)

  const hud1 = await evalJs(`(() => {
    const sr = document.querySelector('sf-app').shadowRoot
    return {
      chips: [...sr.querySelectorAll('.chip')].map((c) => c.textContent.trim()),
      caption: sr.querySelector('.caption') ? 'visible' : 'hidden',
    }
  })()`)
  console.log('hud after tap:', JSON.stringify(hud1))

  await sleep(3000)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync('/tmp/sfgame-play.png', Buffer.from(shot.result.data as string, 'base64'))
  console.log('screenshot saved to /tmp/sfgame-play.png')

  // 长按空白处 → 冷源
  const hold = await evalJs(`(${worldToScreen})(30, 30)`)
  await click(hold.x, hold.y, 600)
  await sleep(400)
  const hud2 = await evalJs(`(() => {
    const sr = document.querySelector('sf-app').shadowRoot
    return [...sr.querySelectorAll('.chip')].map((c) => c.textContent.trim())
  })()`)
  console.log('chips after long-press (expect 3,1):', JSON.stringify(hud2))

  // 结算覆盖层布局检查
  await evalJs(`(() => {
    const app = document.querySelector('sf-app')
    app.hud = { phase: 'won', hotLeft: 3, coldLeft: 1, placed: 2 }
  })()`)
  await sleep(600)
  const shot2 = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync('/tmp/sfgame-win.png', Buffer.from(shot2.result.data as string, 'base64'))
  console.log('win overlay screenshot saved')

  ws.close()
  process.exit(0)
}

main().catch((e) => {
  console.error('E2E failed:', e)
  process.exit(1)
})
