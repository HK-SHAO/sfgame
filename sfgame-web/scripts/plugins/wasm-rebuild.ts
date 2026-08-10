// dev 的 wasm 一体化（原 scripts/dev.ts 子进程方案）：监听前编译一次保证最新 →
// 复用 vite 的 chokidar 监视 assembly/*.ts 与 build-wasm.ts 变更重编（80ms 防抖 + 串行合并）。
// 重编产物落入 main.ts 的 ?url 模块图，vite 自动整页刷新，无需手动发 full-reload
import type { Plugin } from 'vite'
import { join, resolve } from 'node:path'
import { compileWasm } from '../build-wasm.ts'

export function wasmRebuild(): Plugin {
  const assemblyDir = resolve('assembly')
  let timer: ReturnType<typeof setTimeout> | null = null
  let compiling = false
  let pending = false

  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(run, 80)
  }

  async function run() {
    timer = null
    if (compiling) {
      pending = true
      return
    }
    compiling = true
    await compileWasm()
    compiling = false
    if (pending) {
      pending = false
      schedule()
    }
  }

  return {
    name: 'wasm-rebuild',
    // mode 判别而非 apply:'serve'：vitest 也用 serve 命令模式加载 config（apply:'serve' 会命中），
    // 测试链自带 node scripts/build-wasm.ts，插件只需服务真 dev server
    apply: ({ mode }) => mode === 'development',
    async configureServer(server) {
      if (!(await compileWasm())) {
        throw new Error('[wasm] 初始编译失败，请先修复 assembly/ 源码')
      }
      server.watcher.on('change', (p) => {
        if (p.endsWith('.ts') && (p.startsWith(assemblyDir) || p === resolve(join('scripts', 'build-wasm.ts')))) {
          schedule()
        }
      })
    },
  }
}
