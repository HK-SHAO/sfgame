import { bootEngine } from './wasm/engine.ts'
import engineUrl from './wasm/sfengine.wasm?url'
import { mountGtagAnalytics } from './ui/analytics-gtag.ts'

const fetchBytes = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`wasm ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

const showUnsupported = async (reason: 'wasm' | 'webgl' | 'coi' | 'fatal') => {
  await import('./ui/unsupported.ts')
  const el = document.createElement('sf-unsupported') as HTMLElement & { reason: string }
  el.reason = reason
  document.body.replaceChildren(el)
}

if (!crossOriginIsolated) {
  await showUnsupported('coi')
} else {
  const ready = await bootEngine(() => fetchBytes(engineUrl))

  if (ready) {
    mountGtagAnalytics()
    await import('./ui/app.ts')
    document.body.replaceChildren(document.createElement('sf-app'))
    if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {})
    }
  } else {
    await showUnsupported('wasm')
  }
}
