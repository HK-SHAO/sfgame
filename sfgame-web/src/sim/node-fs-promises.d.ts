/**
 * node:fs/promises 的最小环境声明（仅供 fluid-wasm.ts 在 node/bun 直跑时读取
 * wasm 二进制；浏览器构建永不触达该分支）。src 配置不含 node 类型，故在此局部声明。
 */
declare module 'node:fs/promises' {
  interface FileHandleReadResult extends Uint8Array {
    buffer: ArrayBuffer
  }
  export function readFile(path: string | URL): Promise<FileHandleReadResult>
}
