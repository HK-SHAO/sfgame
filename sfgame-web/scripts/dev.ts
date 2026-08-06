// dev 一体化：确保 wasm 最新（跳过时即启动）→ 拉起 vite → 监视 assembly/*.ts 与 build-wasm.ts 变更自动重编
// （vite 检测 wasm 变化整页刷新）。Ctrl+C 一并清理不残留进程。编译逻辑与 flags 单一来源 scripts/build-wasm.ts
import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { compileWasm } from './build-wasm'

const root = import.meta.dir + '/..'
const assemblyDir = join(root, 'assembly')

let compiling = false
let pending = false
let timer: ReturnType<typeof setTimeout> | null = null

async function compile(): Promise<boolean> {
  return compileWasm()
}

function schedule() {
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
  await compile()
  compiling = false
  if (pending) {
    pending = false
    schedule()
  }
}

if (!(await compile())) {
  console.error('[dev] 初始 wasm 编译失败，请先修复 assembly/ 源码')
  process.exit(1)
}

const args = process.argv.slice(2).filter((a) => a !== '--')
const vite = Bun.spawn(['vite', ...args], { cwd: root, stdout: 'inherit', stderr: 'inherit' })

const watchers: FSWatcher[] = []
try {
  watchers.push(
    watch(assemblyDir, { recursive: true }, (_event, name) => {
      if (name?.endsWith('.ts')) schedule()
    }),
  )
  watchers.push(
    watch(import.meta.dir, { recursive: false }, (_event, name) => {
      if (name === 'build-wasm.ts') schedule()
    }),
  )
} catch (err) {
  console.error('[dev] 监视失败（assembly/ 或 scripts/ 不可用）：', err)
  watchers.forEach((w) => w.close())
  process.exit(1)
}

let cleaned = false
function cleanup(code: number) {
  if (cleaned) return
  cleaned = true
  watchers.forEach((w) => w.close())
  vite.kill()
  process.exit(code)
}
process.on('SIGINT', () => cleanup(130))
process.on('SIGTERM', () => cleanup(143))
vite.exited.then((code) => cleanup(code ?? 0))
