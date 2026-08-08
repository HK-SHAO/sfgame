import { bootEngine } from './wasm/engine'
import engineUrl from './wasm/sfengine.wasm?url'

const fetchBytes = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`wasm ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

// 物理 + 渲染数值内核合一（单模块单内存）：加载失败即渲染错误页，绝不带病启动
const ready = await bootEngine(() => fetchBytes(engineUrl))

if (ready) {
  await import('./ui/app')
  document.body.replaceChildren(document.createElement('sf-app'))
} else {
  await import('./ui/unsupported')
  document.body.replaceChildren(document.createElement('sf-unsupported'))
}
