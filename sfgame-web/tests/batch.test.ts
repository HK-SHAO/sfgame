import { expect, test } from 'vitest'
import { MeshBatch, VERTEX_STRIDE } from '../app/render/batch'

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

test('terrainFill：批量展三角与逐段 tri 逐顶点一致', () => {
  const b = new MeshBatch()
  const pts = new Float32Array([0, 1, 2, 0.5, 5, 2])
  b.terrainFill(pts, 6, 10, 0.5, 0.6, 0.7, 1)
  const ref = new MeshBatch()
  ref.tri(0, 1, 2, 0.5, 0, 10, 0.5, 0.6, 0.7, 1)
  ref.tri(2, 0.5, 2, 10, 0, 10, 0.5, 0.6, 0.7, 1)
  ref.tri(2, 0.5, 5, 2, 2, 10, 0.5, 0.6, 0.7, 1)
  ref.tri(5, 2, 5, 10, 2, 10, 0.5, 0.6, 0.7, 1)
  expect(b.count).toBe(ref.count)
  for (let k = 0; k < b.count; k++) expect(vertex(b, k)).toEqual(vertex(ref, k))
})

test('tracers 批量：单调用输出与 polylineFade + disc 逐顶点一致', () => {
  const b = new MeshBatch()
  const buf = b.tracerData
  // 单粒子定长记录：3 点（2 拖尾 + 头部）
  buf[0] = 1; buf[1] = 0; buf[2] = 0
  buf[3] = 3; buf[4] = 0.8
  buf[5] = 0; buf[6] = 0; buf[7] = 0.1
  buf[8] = 2; buf[9] = 0; buf[10] = 0.5
  buf[11] = 4; buf[12] = 0; buf[13] = 0.8
  b.tracers(1, 0.5, 0.3)
  const ref = new MeshBatch()
  ref.polylineFade(new Float32Array([0, 0, 2, 0, 4, 0]), 6, 0.5, 1, 0, 0, new Float32Array([0.1, 0.5, 0.8]))
  ref.disc(4, 0, 0.3, 0.3, 0, 10, 1, 0, 0, 0.8)
  expect(b.count).toBe(ref.count)
  for (let k = 0; k < b.count; k++) expect(vertex(b, k)).toEqual(vertex(ref, k))
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
