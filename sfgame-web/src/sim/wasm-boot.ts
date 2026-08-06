import { initWasm, simdAvailable } from './wasm-fluid'

// 平台无关引导：调用方按运行环境提供取字节实现（浏览器 fetch 资源 / node-bun 读文件）；
// SIMD 探测失败或加载失败一律返回 false，调用方落回 JS 后端，绝不阻塞启动
export async function bootWasm(load: () => Promise<ArrayBuffer | Uint8Array>): Promise<boolean> {
  if (typeof WebAssembly === 'undefined' || !simdAvailable()) return false
  try {
    return initWasm(await load())
  } catch {
    return false
  }
}
