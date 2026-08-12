// 引擎编译入口（单一来源）：build:wasm / dev 插件 / test 共用同一份流程。
// 引擎 = sfgame-web/moon 的 Moonbit 数值内核（流体 + 顶点批 + 示踪三内核合一，wasm 目标）。
// bun run scripts/build-wasm.ts [--force]：产物比全部 moon/ 源码新时跳过编译（mtime 比较）。
// 判 stale 后一律 moon clean 再编：moon 增量链接对 moon.pkg 变更可能失活（实测导出面残留），
// 全量重编 ~1s 级，换取产物与配置必然一致

import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const moonDir = join(root, 'moon')
const outPath = join(root, 'app/wasm/sfengine.wasm')
const artifactSrc = join(moonDir, '_build/wasm/release/build/sfengine.wasm')

function latestSrcMtime(): number | null {
  let latest = 0
  for (const name of readdirSync(moonDir, { recursive: true })) {
    const s = String(name)
    if (s.startsWith('_build')) continue
    if (s.endsWith('.mbt') || s.endsWith('moon.pkg') || s.endsWith('moon.mod')) {
      latest = Math.max(latest, statSync(join(moonDir, s)).mtimeMs)
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
  rmSync(join(moonDir, '_build'), { recursive: true, force: true })
  const r = Bun.spawnSync(['moon', 'build', '--release', '--target', 'wasm'], { cwd: moonDir })
  const ms = (performance.now() - t0).toFixed(0)
  if (!r.success) {
    console.error(`[wasm] 编译 ✗（保留旧产物）${ms}ms`)
    if (r.stderr) process.stderr.write(r.stderr)
    return false
  }
  cpSync(artifactSrc, outPath)
  console.log(`[wasm] 编译 ✓ ${ms}ms`)
  return true
}

if (import.meta.main) {
  const ok = await compileWasm({ force: process.argv.includes('--force') })
  process.exit(ok ? 0 : 1)
}
