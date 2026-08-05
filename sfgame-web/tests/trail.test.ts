import { expect, test } from 'vitest'
import { Trail } from '../src/sim/trail'

test('静止物体：轨迹点随时间老化，过 fadeTime 后存留归零', () => {
  const trail = new Trail(16, 0.5, 6)
  trail.push(10, 20, 0)
  expect(trail.retentionAt(0)).toBe(1)
  trail.push(10, 20, 3)
  expect(trail.retentionAt(0)).toBeCloseTo(0.5, 5)
  trail.push(10, 20, 7)
  expect(trail.retentionAt(0)).toBe(0)
})

test('运动后旧轨迹点按时间淡出：越新存留越高', () => {
  const trail = new Trail(64, 0.5, 6)
  // 以 2 单位/秒沿 x 轴走 10 秒
  for (let t = 0; t <= 10; t += 0.1) trail.push(t * 2, 0, t)
  const oldest = trail.pointAt(0)
  const newest = trail.pointAt(trail.count - 1)
  expect(oldest.t).toBeLessThan(newest.t)
  expect(trail.retentionAt(0)).toBeLessThan(trail.retentionAt(trail.count - 1))
  expect(trail.retentionAt(trail.count - 1)).toBeGreaterThan(0.9)
})

test('走过 fadeTime 后最旧点存留归零', () => {
  const trail = new Trail(256, 0.5, 6)
  for (let t = 0; t <= 30; t += 0.1) trail.push(t * 2, 0, t)
  expect(trail.retentionAt(0)).toBe(0)
})

test('等距采样：点数 ≈ 路程 / sampleDist', () => {
  const trail = new Trail(256, 0.5, 60)
  for (let k = 0; k <= 100; k++) {
    const t = k * 0.1
    trail.push(t, 0, t)
  }
  // 10 单位路程、每 0.5 记一点（含起点）
  expect(trail.count).toBeGreaterThanOrEqual(20)
  expect(trail.count).toBeLessThanOrEqual(22)
})

test('容量上限：环形缓冲覆写最旧点且顺序保持从旧到新', () => {
  const trail = new Trail(4, 1, 100)
  for (let t = 0; t <= 20; t++) trail.push(t * 2, 0, t)
  expect(trail.count).toBe(4)
  for (let k = 0; k < trail.count - 1; k++) {
    expect(trail.pointAt(k).t).toBeLessThan(trail.pointAt(k + 1).t)
    expect(trail.pointAt(k).x).toBeLessThan(trail.pointAt(k + 1).x)
  }
  expect(trail.pointAt(3).x).toBe(40)
})

test('clear 后重新开始记录', () => {
  const trail = new Trail(8, 0.5, 6)
  for (let t = 0; t <= 5; t += 0.5) trail.push(t * 2, 0, t)
  trail.clear()
  expect(trail.count).toBe(0)
  expect(trail.time).toBe(0)
  trail.push(5, 5, 10)
  expect(trail.count).toBe(1)
  expect(trail.retentionAt(0)).toBe(1)
})
