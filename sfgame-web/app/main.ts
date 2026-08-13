import { bootEngine } from './wasm/engine.ts'
import engineUrl from './wasm/sfengine.wasm?url'
import { mountGtagAnalytics } from './ui/analytics-gtag.ts'

const fetchBytes = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`wasm ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

const ready = await bootEngine(() => fetchBytes(engineUrl))

if (ready) {
  mountGtagAnalytics()
  await import('./ui/app.ts')
  document.body.replaceChildren(document.createElement('sf-app'))
  if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  }
} else {
  await import('./ui/unsupported.ts')
  document.body.replaceChildren(document.createElement('sf-unsupported'))
}
