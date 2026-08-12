// Moonbit 数值内核编译入口（单一来源）：build:wasm / dev 插件 / test 共用同一份流程。
// 同源双目标（sfgame-web/moon 模块）：
//  - wasm 目标 → app/wasm/sfengine.wasm（流体 + 顶点批 + 示踪三内核合一引擎）
//  - js 目标   → app/game/sdfjs/sdf.js（SDF 表达式求值器，供 TS 门面直接 import）
// bun run scripts/build-wasm.ts [--force]：产物比全部 moon/ 源码新时跳过编译（mtime 比较）。
// 判 stale 后一律 moon clean 再编：moon 增量链接对 moon.pkg 变更可能失活（实测导出面残留），
// 全量重编 ~1s 级，换取产物与配置必然一致

import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const moonDir = join(root, 'moon')
const engineOut = join(root, 'app/wasm/sfengine.wasm')
const sdfOut = join(root, 'app/game/sdfjs/sdf.js')
const engineArtifact = join(moonDir, '_build/wasm/release/build/sfengine.wasm')
const sdfArtifact = join(moonDir, '_build/js/release/build/sdf/sdf.js')

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
  if (!existsSync(engineOut) || !existsSync(sdfOut)) return true
  const latest = latestSrcMtime()
  if (latest === null) return true
  return latest > statSync(engineOut).mtimeMs || latest > statSync(sdfOut).mtimeMs
}

export async function compileWasm(opts: { force?: boolean } = {}): Promise<boolean> {
  if (!opts.force && !wasmStale()) {
    console.log('[moon] 产物已是最新，跳过编译')
    return true
  }
  const t0 = performance.now()
  rmSync(join(moonDir, '_build'), { recursive: true, force: true })
  for (const target of ['wasm', 'js']) {
    const r = Bun.spawnSync(['moon', 'build', '--release', '--target', target], { cwd: moonDir })
    if (!r.success) {
      const ms = (performance.now() - t0).toFixed(0)
      console.error(`[moon] ${target} 编译 ✗（保留旧产物）${ms}ms`)
      if (r.stderr) process.stderr.write(r.stderr)
      return false
    }
  }
  cpSync(engineArtifact, engineOut)
  cpSync(sdfArtifact, sdfOut)
  console.log(`[moon] 编译 ✓ ${(performance.now() - t0).toFixed(0)}ms（wasm 引擎 + js sdf）`)
  return true
}

if (import.meta.main) {
  const ok = await compileWasm({ force: process.argv.includes('--force') })
  process.exit(ok ? 0 : 1)
}
