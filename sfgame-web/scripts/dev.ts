// dev 一体化：初始编译 wasm → 监视 native/*.c 变更自动重编（vite 检测 wasm 变化整页刷新）→ 拉起 vite。
// Ctrl+C 一并清理不残留进程。编译经 native/build.sh（emcc，需本机 emsdk）
import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'

const root = import.meta.dir + '/..'

let compiling = false
let pending = false
let timer: ReturnType<typeof setTimeout> | null = null

async function compile(): Promise<boolean> {
  const t0 = performance.now()
  const r = Bun.spawnSync(['sh', 'native/build.sh'], { cwd: root })
  const ms = (performance.now() - t0).toFixed(0)
  if (r.success) {
    console.log(`[wasm] 编译 ✓ ${ms}ms`)
    return true
  }
  console.error(`[wasm] 编译 ✗（保留旧产物）${ms}ms`)
  if (r.stderr) process.stderr.write(r.stderr)
  return false
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
  console.error('[dev] 初始 wasm 编译失败，请先修复 native/ 源码或确认 emsdk 环境')
  process.exit(1)
}

const args = process.argv.slice(2).filter((a) => a !== '--')
const vite = Bun.spawn(['vite', ...args], { cwd: root, stdout: 'inherit', stderr: 'inherit' })

let watcher: FSWatcher | null = null
try {
  watcher = watch(join(root, 'native'), { recursive: true }, (_event, name) => {
    if (name?.endsWith('.c') || name?.endsWith('.sh')) schedule()
  })
} catch (err) {
  console.error('[dev] native 监视失败：', err)
}

let cleaned = false
function cleanup(code: number) {
  if (cleaned) return
  cleaned = true
  watcher?.close()
  vite.kill()
  process.exit(code)
}
process.on('SIGINT', () => cleanup(130))
process.on('SIGTERM', () => cleanup(143))
vite.exited.then((code) => cleanup(code ?? 0))
