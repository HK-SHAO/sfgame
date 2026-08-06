import { expect, test } from 'vitest'
import { PerformanceGovernor, TRACER_TIERS, DPR_TIERS_COARSE } from '../src/core/governor'

const DPR = [2, 1.5, 1.0]

test('持续慢帧 151 帧才降档，先 tracer 到底再 dpr', () => {
  const g = new PerformanceGovernor(TRACER_TIERS, DPR)
  for (let i = 0; i < 150; i++) expect(g.record(20, 1)).toBeNull()
  expect(g.record(20, 1)).toBe('tracer')
  expect(g.tracerLevel).toBe(1)
  // 继续慢帧直到双档到底：tracer 剩 4 次、dpr 2 次，各间隔 151 帧
  const seen: string[] = []
  for (let i = 0; i < 7 * 151; i++) {
    const a = g.record(20, 1)
    if (a) seen.push(a)
  }
  expect(seen.filter((a) => a === 'tracer')).toHaveLength(TRACER_TIERS.length - 2)
  expect(seen.filter((a) => a === 'dpr')).toHaveLength(DPR.length - 1)
  expect(g.tracerLevel).toBe(TRACER_TIERS.length - 1)
  expect(g.dprTier).toBe(DPR.length - 1)
  // 到底后不再动作
  expect(g.record(20, 1)).toBeNull()
})

test('预算随速率放大：倍速下同成本不触发', () => {
  const g = new PerformanceGovernor(TRACER_TIERS, DPR)
  for (let i = 0; i < 500; i++) expect(g.record(20, 4)).toBeNull()
  expect(g.tracerLevel).toBe(0)
})

test('偶发卡顿不误触发：慢帧穿插快帧，EMA 不持续超预算', () => {
  const g = new PerformanceGovernor(TRACER_TIERS, DPR)
  // 每 50 帧一帧 30ms，其余 1ms：EMA 每次 ~18 帧内回落，慢帧计数远达不到阈值
  for (let i = 0; i < 500; i++) {
    const a = g.record(i % 50 === 0 ? 30 : 1, 1)
    expect(a).toBeNull()
  }
  expect(g.tracerLevel).toBe(0)
  expect(g.dprTier).toBe(0)
})

test('持续慢帧后 EMA 平滑回落期间仍计数（平滑不是瞬间缓解）', () => {
  const g = new PerformanceGovernor(TRACER_TIERS, DPR)
  for (let i = 0; i < 150; i++) g.record(20, 1)
  // 快帧第 1 帧 EMA≈19 > 13：慢帧计数 151 触发降级，平滑过渡而非瞬时清零
  expect(g.record(1, 1)).toBe('tracer')
  expect(g.tracerLevel).toBe(1)
})

test('initialTracerLevel（reduce-motion）到底后直接转 dpr', () => {
  const g = new PerformanceGovernor(TRACER_TIERS, DPR, {
    initialTracerLevel: TRACER_TIERS.length - 1,
  })
  const seen: string[] = []
  for (let i = 0; i < 400; i++) {
    const a = g.record(20, 1)
    if (a) seen.push(a)
  }
  expect(seen.every((a) => a === 'dpr')).toBe(true)
  expect(seen).toHaveLength(DPR.length - 1)
})

test('pixelRatio 按档钳制，设备 dpr 缺失时以 1 计', () => {
  const g = new PerformanceGovernor(TRACER_TIERS, DPR_TIERS_COARSE)
  expect(g.pixelRatio(3)).toBe(2)
  expect(g.pixelRatio(1)).toBe(1)
  expect(g.pixelRatio(0)).toBe(1)
})
