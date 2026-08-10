// 统一 wasm 编译入口（单一来源）：build:wasm / dev 插件 / test 共用同一份 asc flags，杜绝双重维护漂移。
// bun run scripts/build-wasm.ts [--force]：产物比全部 assembly/*.ts 新时跳过编译（mtime 比较，
// git checkout 场景源码 mtime 刷新、产物不入库保持旧值，判断安全）。
// asc 经 bunx 调用（不依赖 PATH 注入，直接 bun scripts/... 也能跑）；dev 插件的重编路径同样走这里（Bun.spawnSync）。

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const ASC_FLAGS = [
  'assembly/engine.ts',
  '-o',
  'app/wasm/sfengine.wasm',
  '-O3',
  '--noAssert',
  '--runtime',
  'stub',
  '--enable',
  'simd',
]

// 一律以仓库根为 cwd：脚本直接跑与 vite 打包 config 内联引用（import.meta.dir 经 esbuild 内联后不可靠）都成立
const root = process.cwd()
const outPath = join(root, 'app/wasm/sfengine.wasm')
const srcDir = join(root, 'assembly')

// assembly/ 下所有 .ts 的最晚 mtime；目录缺失返回 null
function latestSrcMtime(): number | null {
  if (!existsSync(srcDir)) return null
  let latest = 0
  for (const name of readdirSync(srcDir, { recursive: true })) {
    if (typeof name === 'string' && name.endsWith('.ts')) {
      latest = Math.max(latest, statSync(join(srcDir, name)).mtimeMs)
    }
  }
  return latest || null
}

export function wasmStale(): boolean {
  if (!existsSync(outPath)) return true
  const latest = latestSrcMtime()
  return latest === null || latest > statSync(outPath).mtimeMs
}

export async function compileWasm(opts: { force?: boolean } = {}): Promise<boolean> {
  if (!opts.force && !wasmStale()) {
    console.log('[wasm] 产物已是最新，跳过编译')
    return true
  }
  const t0 = performance.now()
  const r = Bun.spawnSync(['bunx', 'asc', ...ASC_FLAGS], { cwd: root })
  const ms = (performance.now() - t0).toFixed(0)
  if (r.success) {
    console.log(`[wasm] 编译 ✓ ${ms}ms`)
    return true
  }
  console.error(`[wasm] 编译 ✗（保留旧产物）${ms}ms`)
  if (r.stderr) process.stderr.write(r.stderr)
  return false
}

if (import.meta.main) {
  const ok = await compileWasm({ force: process.argv.includes('--force') })
  process.exit(ok ? 0 : 1)
}
