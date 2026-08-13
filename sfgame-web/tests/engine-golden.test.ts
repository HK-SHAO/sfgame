// 物理位稳定性回归（golden hash）：内核数值输出钉死在迁移基线（assembly→Moonbit 迁移时
// 经双引擎逐位对拍验证后固化）。混沌流场下任何浮点结合律/舍入漂移都会改变这些哈希——
// 物理位型变化会使已录通关最佳时间的可复现性失效，故必须响亮失败，人工确认后才可更新基线。
// 场景与期望值在 tests/golden-core.ts（与 scripts/print-golden.ts 共用）；回填流程：
// bun run scripts/print-golden.ts 打印当前值 → 人工确认变更 → 更新 golden-core.ts 期望
import { expect, test } from 'vitest'
import {
  BATCH_GOLDEN,
  FLUID_SCENARIOS,
  runBatchGolden,
  runFluidGolden,
  runTracerGolden,
  TRACER_GOLDEN,
} from './golden-core.ts'

for (const [name, sc] of FLUID_SCENARIOS) {
  test(`流体 golden：${name}`, () => {
    expect(runFluidGolden(name, sc), name).toEqual(sc.golden)
  })
}

test('顶点批 golden：图元/地形/示踪三场景', () => {
  expect(runBatchGolden()).toEqual(BATCH_GOLDEN)
})

test('示踪粒子 golden：同种子全状态演化', () => {
  expect(runTracerGolden()).toEqual(TRACER_GOLDEN)
})
