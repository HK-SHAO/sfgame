import { expect, test } from 'vitest'
import { Trail } from '../src/sim/trail'

test('静止物体：轨迹点存留不随时间衰减（按路程淡出）', () => {
  const trail = new Trail(16, 0.5, 6)
  trail.push(10, 20)
  for (let i = 0; i < 1000; i++) trail.push(10, 20)
  expect(trail.odometer).toBe(0)
  expect(trail.count).toBe(1)
  expect(trail.retentionAt(0)).toBe(1)
})

test('运动后旧轨迹点按走过路程淡出', () => {
  const trail = new Trail(64, 0.5, 6)
  // 沿 x 轴走 3 个单位
  for (let x = 0; x <= 30; x++) trail.push(x * 0.1, 0)
  const oldest = trail.pointAt(0)
  const newest = trail.pointAt(trail.count - 1)
  expect(oldest.odo).toBeLessThan(newest.odo)
  expect(trail.retentionAt(0)).toBeLessThan(trail.retentionAt(trail.count - 1))
  expect(trail.retentionAt(trail.count - 1)).toBeGreaterThan(0.9)
})

test('走过 fadeDist 后最旧点存归零', () => {
  const trail = new Trail(256, 0.5, 6)
  for (let x = 0; x <= 100; x++) trail.push(x * 0.1, 0)
  expect(trail.odometer).toBeCloseTo(10, 5)
  expect(trail.retentionAt(0)).toBeLessThanOrEqual(0)
})

test('等距采样：点数 ≈ 路程 / sampleDist', () => {
  const trail = new Trail(256, 0.5, 60)
  for (let x = 0; x <= 100; x++) trail.push(x * 0.1, 0)
  // 10 单位路程、每 0.5 记一点（含起点）
  expect(trail.count).toBeGreaterThanOrEqual(20)
  expect(trail.count).toBeLessThanOrEqual(22)
})

test('容量上限：环形缓冲覆写最旧点且顺序保持从旧到新', () => {
  const trail = new Trail(4, 1, 100)
  for (let x = 0; x <= 20; x++) trail.push(x, 0)
  expect(trail.count).toBe(4)
  for (let k = 0; k < trail.count - 1; k++) {
    expect(trail.pointAt(k).odo).toBeLessThan(trail.pointAt(k + 1).odo)
    expect(trail.pointAt(k).x).toBeLessThan(trail.pointAt(k + 1).x)
  }
  expect(trail.pointAt(3).x).toBe(20)
})

test('clear 后重新开始记录', () => {
  const trail = new Trail(8, 0.5, 6)
  for (let x = 0; x <= 10; x++) trail.push(x, 0)
  trail.clear()
  expect(trail.count).toBe(0)
  expect(trail.odometer).toBe(0)
  trail.push(5, 5)
  expect(trail.count).toBe(1)
  expect(trail.retentionAt(0)).toBe(1)
})
