import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { initWasm, simdAvailable } from '../src/sim/fluid'

// 唯一物理后端 = WASM·SIMD：全局预热，任一测试文件无需各自加载；
// 失败即抛错（build:wasm 缺失 / 运行时无 SIMD 都是环境问题，不该静默）
if (!simdAvailable()) throw new Error('当前运行时不支持 WASM SIMD，无法运行物理测试')
const wasmPath = fileURLToPath(new URL('../src/sim/wasm/sfsim.wasm', import.meta.url))
if (!initWasm(readFileSync(wasmPath))) throw new Error('流体内核加载失败（先 bun run build:wasm）')
