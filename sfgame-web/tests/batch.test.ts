import { expect, test } from 'vitest'
import { MeshBatch, VERTEX_STRIDE } from '../src/render/batch'

function vertex(b: MeshBatch, k: number) {
  const o = k * VERTEX_STRIDE
  return Array.from(b.data.subarray(o, o + VERTEX_STRIDE))
}

test('stroke：线段展开为宽度正确的四边形，零长度无顶点', () => {
  const b = new MeshBatch()
  b.stroke(0, 0, 2, 0, 0.4, 1, 1, 1, 1)
  expect(b.count).toBe(6)
  for (let k = 0; k < 6; k++) {
    const [x, y] = vertex(b, k)
    expect(Math.abs(y)).toBeCloseTo(0.2, 5)
    expect(x).toBeGreaterThanOrEqual(-1e-5)
    expect(x).toBeLessThanOrEqual(2 + 1e-5)
  }
  b.stroke(2, 3, 2, 3, 1, 1, 1, 1, 1)
  expect(b.count).toBe(6)
})

test('polyline：直角转角斜接相连，共线段直通无冗余折角', () => {
  const b = new MeshBatch()
  b.polyline(new Float32Array([0, 0, 2, 0, 2, 2]), 6, 1, 1, 1, 1, 1)
  expect(b.count).toBe(12)
  const corners = new Set<string>()
  for (let k = 0; k < 12; k++) {
    const [x, y] = vertex(b, k)
    corners.add(`${x.toFixed(4)},${y.toFixed(4)}`)
  }
  expect(corners.has('2.5000,-0.5000')).toBe(true)
  expect(corners.has('1.5000,0.5000')).toBe(true)

  const flat = new MeshBatch()
  flat.polyline(new Float32Array([0, 0, 1, 0, 2, 0]), 6, 0.4, 1, 1, 1, 1)
  expect(flat.count).toBe(12)
  for (let k = 0; k < 12; k++) {
    expect(Math.abs(vertex(flat, k)[1])).toBeCloseTo(0.2, 5)
  }
})

test('polylineFade：逐顶点 alpha 随数组生效', () => {
  const b = new MeshBatch()
  b.polylineFade(new Float32Array([0, 0, 2, 0]), 4, 0.5, 1, 0, 0, new Float32Array([0.25, 0.75]))
  expect(b.count).toBe(6)
  expect(vertex(b, 0)[5]).toBeCloseTo(0.25, 5)
  expect(vertex(b, 1)[5]).toBeCloseTo(0.75, 5)
})

test('静态容量：写满后整体丢弃图元不越界，reset 复用缓冲', () => {
  const b = new MeshBatch()
  const cap = b.capacity
  expect(cap).toBeGreaterThanOrEqual(131072)
  for (let i = 0; i < cap / 6; i++) b.rect(0, 0, 1, 1, 1, 1, 1, 1)
  expect(b.count).toBe(cap)
  b.tri(0, 0, 1, 0, 0, 1, 1, 1, 1, 1)
  expect(b.count).toBe(cap)

  const before = b.data
  b.reset()
  expect(b.count).toBe(0)
  b.tri(0, 0, 1, 0, 0, 1, 1, 1, 1, 1)
  expect(b.count).toBe(3)
  expect(b.data).toBe(before)
})
