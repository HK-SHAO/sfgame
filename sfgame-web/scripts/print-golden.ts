// golden 基线打印工具（回填用）：打印当前内核/求值器的计算值与 tests/golden-core.ts 中的期望值。
// 改物理后流程：跑本脚本 → 人工确认数值变更符合预期 → 把打印值回填 golden-core.ts 期望字段。
// 只打印不写文件：更新基线必须人工落笔（防顺手更新掩盖回归，见 AGENTS.md 验证策略）
import { BATCH_GOLDEN, FLUID_SCENARIOS, runBatchGolden, runFluidGolden, runTracerGolden, TRACER_GOLDEN } from '../tests/golden-core.ts'
import { readFileSync } from 'node:fs'
import { initEngine } from '../app/wasm/engine.ts'

if (!initEngine(readFileSync(new URL('../app/wasm/sfengine.wasm', import.meta.url)))) {
  console.error('wasm 加载失败：先 bun run build:wasm')
  process.exit(1)
}

console.log('===== 流体 golden =====')
for (const [name, sc] of FLUID_SCENARIOS) {
  const got = runFluidGolden(name, sc)
  const same = JSON.stringify(got) === JSON.stringify(sc.golden)
  console.log(`${same ? '✓' : '✗ 漂移'} ${name}`)
  for (const k of ['u', 'v', 't', 'fx', 'probes'] as const) {
    console.log(`  ${k}: got=${got[k]}  want=${sc.golden[k]}${got[k] === sc.golden[k] ? '' : '  ←'}`)
  }
}

console.log('\n===== 顶点批 golden =====')
{
  const got = runBatchGolden()
  for (const k of ['mix', 'terrain', 'tracers'] as const) {
    const same = got[k].count === BATCH_GOLDEN[k].count && got[k].hash === BATCH_GOLDEN[k].hash
    console.log(`${same ? '✓' : '✗ 漂移'} ${k}: got=(${got[k].count}, ${got[k].hash}) want=(${BATCH_GOLDEN[k].count}, ${BATCH_GOLDEN[k].hash})`)
  }
}

console.log('\n===== 示踪 golden =====')
{
  const got = runTracerGolden()
  const flat: Record<string, string> = {
    'init.x': got.init.x, 'init.y': got.init.y, 'init.life': got.init.life,
    '240.x': got.after240.x, '240.y': got.after240.y, '240.life': got.after240.life,
    '240.maxLife': got.after240.maxLife, '240.trailX': got.after240.trailX,
    '240.trailY': got.after240.trailY, '240.trailT': got.after240.trailT,
    '240.trailN': got.after240.trailN, time: got.time,
  }
  const want: Record<string, string> = {
    'init.x': TRACER_GOLDEN.init.x, 'init.y': TRACER_GOLDEN.init.y, 'init.life': TRACER_GOLDEN.init.life,
    '240.x': TRACER_GOLDEN.after240.x, '240.y': TRACER_GOLDEN.after240.y, '240.life': TRACER_GOLDEN.after240.life,
    '240.maxLife': TRACER_GOLDEN.after240.maxLife, '240.trailX': TRACER_GOLDEN.after240.trailX,
    '240.trailY': TRACER_GOLDEN.after240.trailY, '240.trailT': TRACER_GOLDEN.after240.trailT,
    '240.trailN': TRACER_GOLDEN.after240.trailN, time: TRACER_GOLDEN.time,
  }
  for (const k of Object.keys(want)) {
    const same = flat[k] === want[k]
    console.log(`${same ? '✓' : '✗ 漂移'} ${k}: got=${flat[k]} want=${want[k]}`)
  }
}
