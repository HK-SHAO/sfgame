import { bootEngine } from './wasm/engine.ts'
import engineUrl from './wasm/sfengine.wasm?url'
import { mountGtagAnalytics } from './ui/analytics-gtag.ts'
import type { UnsupportedReason } from './ui/unsupported.ts'
import { registerSW } from 'virtual:pwa-register'

const fetchBytes = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`wasm ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

const showUnsupported = async (reason: UnsupportedReason) => {
  await import('./ui/unsupported.ts')
  const el = document.createElement('sf-unsupported')
  el.reason = reason
  document.body.replaceChildren(el)
}

if (typeof crossOriginIsolated === 'undefined' || !crossOriginIsolated) {
  await showUnsupported('coi')
} else {
  const ready = await bootEngine(() => fetchBytes(engineUrl))

  if (ready) {
    mountGtagAnalytics()
    await import('./ui/app.ts')
    document.body.replaceChildren(document.createElement('sf-app'))
    registerSW()
  } else {
    await showUnsupported('wasm')
  }
}
