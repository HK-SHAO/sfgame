import { expect, test } from 'vitest'
import { MeshBatch, VERTEX_STRIDE } from '../app/render/batch.ts'

function vertex(b: MeshBatch, k: number) {
  const o = k * VERTEX_STRIDE
  return Array.from(b.data.subarray(o, o + VERTEX_STRIDE))
}

function terrainVertex(b: MeshBatch, k: number) {
  const o = k * VERTEX_STRIDE
  return Array.from(b.terrainData.subarray(o, o + VERTEX_STRIDE))
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

test('ring：闭环折线斜接拼接，带宽带半径正确、alpha 恒定（覆盖非淡变 miter 路径）', () => {
  const b = new MeshBatch()
  b.ring(0, 0, 2, 2, 0, 32, 0.5, 1, 1, 1, 0.8)
  // 闭环 seg=32 → 32 段 × 6 顶点；miter 接头随角变锐外延，段多角钝后收敛到带宽内
  expect(b.count).toBe(192)
  for (let k = 0; k < b.count; k++) {
    const [x, y, , , , a] = vertex(b, k)
    const d = Math.hypot(x, y)
    expect(d).toBeGreaterThanOrEqual(1.74)
    expect(d).toBeLessThanOrEqual(2.26)
    expect(a).toBeCloseTo(0.8, 5)
  }
})

test('polylineFade：逐顶点 alpha 随数组生效', () => {
  const b = new MeshBatch()
  b.polylineFade(new Float32Array([0, 0, 2, 0]), 4, 0.5, 1, 0, 0, new Float32Array([0.25, 0.75]))
  expect(b.count).toBe(6)
  expect(vertex(b, 0)[5]).toBeCloseTo(0.25, 5)
  expect(vertex(b, 1)[5]).toBeCloseTo(0.75, 5)
})

test('terrainBake：marching squares 固体填充——等值线精确切割、全固格深度色、空气格跳过', () => {
  const b = new MeshBatch()
  // 3×3 格心场（cell=1，原点 (0,10)）：顶行空气（d=1）、下两行实体（d=−1）
  const f = b.terrainField
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) f[j * 3 + i] = j === 0 ? 1 : -1
  // 地表色红 → 深处色蓝，深度特征长度 2：d=−1 处 k = 1−exp(−1/2)
  expect(b.terrainSetup(3, 3, 0, 10, 1, 1, 0, 0, 0, 0, 1, 2)).toBe(true)
  expect(b.terrainSetup(3, 3, 0, 10, 1, 1, 0, 0, 0, 0, 1, 0)).toBe(false) // 长度非法
  expect(b.terrainSetup(200, 100, 0, 0, 1, 1, 0, 0, 0, 0, 1, 2)).toBe(false) // 超容量
  b.terrainSetup(3, 3, 0, 10, 1, 1, 0, 0, 0, 0, 1, 2)
  // 行 0：上空气下实体 → 等值线 y=10.5 切出矩形 6 顶点；行 1 全固 6 顶点；两列共 24
  expect(b.terrainBake(0, 0, 2, 2)).toBe(24)
  const cut = Array.from({ length: 6 }, (_, k) => terrainVertex(b, k)) // 首格（i=0,j=0）
  // 等值线交点：y=10.5，地表色（1,0,0）不透明
  for (const v of cut.filter((v) => Math.abs(v[1] - 10.5) < 1e-5)) expect(v.slice(2)).toEqual([1, 0, 0, 1])
  // 实体角点 d=−1：指数渐近混色 k = 1−exp(−0.5)
  const k = 1 - Math.exp(-0.5)
  for (const v of cut.filter((v) => v[1] === 11)) {
    expect(v[2]).toBeCloseTo(1 - k, 5)
    expect(v[4]).toBeCloseTo(k, 5)
    expect(v[5]).toBe(1)
  }

  // 越界：位置外推、场钳至边缘列（地形延展），不崩不丢
  expect(b.terrainBake(-1, 0, 0, 1)).toBe(6)
  let minX = Infinity
  for (let k = 0; k < 6; k++) minX = Math.min(minX, terrainVertex(b, k)[0])
  expect(minX).toBe(-1)

  // 全空气场：零顶点
  f.fill(1)
  expect(b.terrainBake(0, 0, 2, 2)).toBe(0)

  // 鞍点（对角双固体、格心空气）：拆两块独立三角形，不在格心错误连通
  f.fill(1.5)
  f[0] = -1 // TL
  f[4] = -1 // BR（对角双固体，格心均值 >0 = 空气）
  expect(b.terrainBake(0, 0, 1, 1)).toBe(6)
  for (let k = 0; k < 6; k++) {
    const [x, y] = terrainVertex(b, k)
    expect(x > 0.3 && x < 0.7 && y - 10 > 0.3 && y - 10 < 0.7).toBe(false) // 格心无顶点
  }
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
