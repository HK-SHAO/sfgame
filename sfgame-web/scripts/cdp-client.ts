/**
 * Chrome DevTools Protocol 最小客户端（headless 浏览器验证用）。
 *
 * 传输层刻意隔离：业务脚本只依赖 connect/send/evalv 三个方法，不接触
 * WebSocket/JSON 协议细节。后续若迁移到 Playwright 的 CDPSession
 * （`browser.newContext().newCDPSession(page)`）或 chrome-devtools-mcp，
 * 只需替换本模块实现、保持同一接口，browser-consistency.ts 无需改动。
 * （2026-08：本机网络受限无法安装新依赖，暂保留零依赖 CDP 直连。）
 */

export class CdpClient {
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
