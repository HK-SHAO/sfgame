import { urlState } from './game/state'
import { bootWasm } from './sim/wasm-boot'
import { setBackendPref } from './sim/wasm-fluid'
import wasmUrl from './sim/wasm/sfsim.wasm?url'

// 物理后端先于 UI 装配就绪：加载失败/不支持自动落回 JS，绝不阻塞启动
const be = urlState.get('be')
setBackendPref(be)
if (be !== 'js') {
  await bootWasm(async () => {
    const res = await fetch(wasmUrl)
    if (!res.ok) throw new Error(`wasm ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  })
}
await import('./ui/app')
