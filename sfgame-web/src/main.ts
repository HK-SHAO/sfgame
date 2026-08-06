import { bootWasm } from './sim/fluid'
import wasmUrl from './sim/wasm/sfsim.wasm?url'

// WASM·SIMD 是唯一物理后端：加载失败即渲染错误页，绝不带病启动
const ready = await bootWasm(async () => {
  const res = await fetch(wasmUrl)
  if (!res.ok) throw new Error(`wasm ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
})

if (ready) {
  await import('./ui/app')
} else {
  const { mountUnsupported } = await import('./ui/unsupported')
  mountUnsupported()
}
