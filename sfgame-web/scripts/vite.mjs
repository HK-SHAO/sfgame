// vite CLI 门面：以 bun 运行时直跑。`bun vite` 会尊重 bin 首行 node shebang 而落到 Node，
// 使 vite.config.ts → wasm-rebuild → build-wasm 链的 Bun 全局失效；这里直接 import 入口绕过 shebang。
// 参数原样透传（vite CLI 解析 process.argv.slice(2)）；argv[1] 复写仅为 help 里显示 bin 名。
process.argv[1] = new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname
await import('../node_modules/vite/bin/vite.js')
