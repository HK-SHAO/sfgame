import { bootEngine } from './wasm/engine'
import { urlState } from './game/state'
import engineUrl from './wasm/sfengine.wasm?url'

const fetchBytes = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`wasm ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

// 物理 + 渲染数值内核合一（单模块单内存）：加载失败即渲染错误页，绝不带病启动
const ready = await bootEngine(() => fetchBytes(engineUrl))

// 首屏 idle 预取游戏内核（含 HUD/结算），进关零等待；弱网（saveData）跳过；
// 预热只下载+注册组件，不触碰 app 的 gameReady/devToolsReady 门闩
const prefetchIdle = (fn: () => void) => {
  // navigator.connection 不在 TS DOM lib（NetworkInformation 是提案）
  const saveData = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData
  if (saveData) return
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(fn, { timeout: 3000 })
  } else {
    setTimeout(fn, 1500)
  }
}

if (ready) {
  prefetchIdle(() => {
    // 游戏内核整图：sf-game + HUD + 结算（各自动态入口，须逐一预取）
    void Promise.all([import('./ui/sf-game'), import('./ui/hud'), import('./ui/win-overlay')])
    if (urlState.get('dev')) void import('./dev/devtools')
  })
  await import('./ui/app')
  document.body.replaceChildren(document.createElement('sf-app'))
} else {
  await import('./ui/unsupported')
  document.body.replaceChildren(document.createElement('sf-unsupported'))
}
