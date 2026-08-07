import { expect, test } from 'vitest'
import { Trail } from '../app/sim/trail'

test('随时间淡出 + 等距采样 + 环形覆写（停驻时旧轨迹同样老化）', () => {
  const trail = new Trail(16, 0.5, 6)
  trail.push(10, 20, 0)
  expect(trail.retentionAt(0)).toBe(1)
  trail.push(10, 20, 3)
  expect(trail.retentionAt(0)).toBeCloseTo(0.5, 5)
  trail.push(10, 20, 7)
  expect(trail.retentionAt(0)).toBe(0)

  const moving = new Trail(256, 0.5, 60)
  for (let k = 0; k <= 100; k++) moving.push(k * 0.1, 0, k * 0.1)
  expect(moving.count).toBeGreaterThanOrEqual(20)
  expect(moving.count).toBeLessThanOrEqual(22)
  expect(moving.retentionAt(moving.count - 1)).toBeGreaterThan(0.9)

  const ring = new Trail(4, 1, 100)
  for (let t = 0; t <= 20; t++) ring.push(t * 2, 0, t)
  expect(ring.count).toBe(4)
  for (let k = 0; k < ring.count - 1; k++) {
    expect(ring.pointAt(k).t).toBeLessThan(ring.pointAt(k + 1).t)
  }
  expect(ring.pointAt(3).x).toBe(40)
})
