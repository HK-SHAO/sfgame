import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { initEngine } from '../app/wasm/engine.ts'

// 物理 + 渲染数值内核均为 WASM（moon/ 编译的单模块）：全局预热，任一测试文件无需各自加载；
// 失败即抛错（build:wasm 缺失是环境问题，不该静默）
const wasmPath = fileURLToPath(new URL('../app/wasm/sfengine.wasm', import.meta.url))
if (!initEngine(readFileSync(wasmPath))) throw new Error('WASM 引擎加载失败（先 bun run build:wasm）')
