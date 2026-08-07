import { expect, test } from 'vitest'
import { PerformanceGovernor, DPR_TIERS } from '../app/core/governor'

const DPR = [2, 1.5, 1.0]

test('持续慢帧 151 帧才降 dpr 一档，到底后不再动作', () => {
  const g = new PerformanceGovernor(DPR)
  for (let i = 0; i < 150; i++) expect(g.record(20, 1)).toBe(false)
  expect(g.record(20, 1)).toBe(true)
  expect(g.dprTier).toBe(1)
  let downgrades = 1
  for (let i = 0; i < 400; i++) {
    if (g.record(20, 1)) downgrades++
  }
  expect(downgrades).toBe(DPR.length - 1)
  expect(g.dprTier).toBe(DPR.length - 1)
  expect(g.record(20, 1)).toBe(false)
})

test('预算随速率放大：倍速下同成本不触发', () => {
  const g = new PerformanceGovernor(DPR)
  for (let i = 0; i < 500; i++) expect(g.record(20, 4)).toBe(false)
  expect(g.dprTier).toBe(0)
})

test('偶发卡顿不误触发：慢帧穿插快帧，EMA 不持续超预算', () => {
  const g = new PerformanceGovernor(DPR)
  for (let i = 0; i < 500; i++) {
    expect(g.record(i % 50 === 0 ? 30 : 1, 1)).toBe(false)
  }
  expect(g.dprTier).toBe(0)
})

test('持续慢帧后 EMA 平滑回落期间仍计数（平滑不是瞬间缓解）', () => {
  const g = new PerformanceGovernor(DPR)
  for (let i = 0; i < 150; i++) g.record(20, 1)
  // 快帧第 1 帧 EMA≈19 > 13：慢帧计数 151 触发降级，平滑过渡而非瞬时清零
  expect(g.record(1, 1)).toBe(true)
  expect(g.dprTier).toBe(1)
})

test('pixelRatio 按档钳制，设备 dpr 缺失时以 1 计', () => {
  const g = new PerformanceGovernor(DPR_TIERS)
  expect(g.pixelRatio(3)).toBe(2)
  expect(g.pixelRatio(1)).toBe(1)
  expect(g.pixelRatio(0)).toBe(1)
})
