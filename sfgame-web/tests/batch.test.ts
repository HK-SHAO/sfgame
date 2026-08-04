import { describe, expect, test } from 'vitest'
import { MeshBatch, VERTEX_STRIDE } from '../src/core/batch'

/** 顶点缓冲为 float32（GPU 上传格式），断言容差按 float32 精度取 */
const EPS = 1e-5

function vertex(b: MeshBatch, k: number) {
  const o = k * VERTEX_STRIDE
  return Array.from(b.data.subarray(o, o + VERTEX_STRIDE))
}

function expectVertex(b: MeshBatch, k: number, expected: number[]) {
  const v = vertex(b, k)
  expect(v.length).toBe(expected.length)
  for (let i = 0; i < v.length; i++) expect(v[i]).toBeCloseTo(expected[i], 5)
}

describe('MeshBatch', () => {
  test('tri：写入 3 个顶点，位置与颜色正确', () => {
    const b = new MeshBatch()
    b.tri(0, 0, 1, 0, 0, 1, 0.5, 0.25, 0.125, 0.8)
    expect(b.count).toBe(3)
    expectVertex(b, 0, [0, 0, 0.5, 0.25, 0.125, 0.8])
    expectVertex(b, 1, [1, 0, 0.5, 0.25, 0.125, 0.8])
    expectVertex(b, 2, [0, 1, 0.5, 0.25, 0.125, 0.8])
  })

  test('rect：两三角形覆盖四角', () => {
    const b = new MeshBatch()
    b.rect(1, 2, 5, 8, 1, 1, 1, 1)
    expect(b.count).toBe(6)
    for (let k = 0; k < 6; k++) {
      const [x, y] = vertex(b, k)
      expect([1, 5].some((v) => Math.abs(x - v) < EPS)).toBe(true)
      expect([2, 8].some((v) => Math.abs(y - v) < EPS)).toBe(true)
    }
  })

  test('rectVGrad：顶边取顶色、底边取底色', () => {
    const b = new MeshBatch()
    b.rectVGrad(0, 0, 4, 6, 1, 0, 0, 1, 0, 0, 1, 0.5)
    for (let k = 0; k < 6; k++) {
      const [, y, r, , bl, a] = vertex(b, k)
      if (Math.abs(y) < EPS) {
        expect(r).toBeCloseTo(1, 5)
        expect(bl).toBeCloseTo(0, 5)
        expect(a).toBeCloseTo(1, 5)
      } else {
        expect(r).toBeCloseTo(0, 5)
        expect(bl).toBeCloseTo(1, 5)
        expect(a).toBeCloseTo(0.5, 5)
      }
    }
  })

  test('stroke：水平线段展开为宽度正确的四边形', () => {
    const b = new MeshBatch()
    b.stroke(0, 0, 2, 0, 0.4, 1, 1, 1, 1)
    expect(b.count).toBe(6)
    for (let k = 0; k < 6; k++) {
      const [x, y] = vertex(b, k)
      expect(Math.abs(y)).toBeCloseTo(0.2, 5)
      expect(x).toBeGreaterThanOrEqual(-EPS)
      expect(x).toBeLessThanOrEqual(2 + EPS)
    }
  })

  test('stroke：竖直线段法线方向正确（左右各半宽）', () => {
    const b = new MeshBatch()
    b.stroke(1, 0, 1, 3, 0.6, 0, 0, 0, 1)
    for (let k = 0; k < 6; k++) {
      const x = vertex(b, k)[0]
      expect(Math.min(Math.abs(x - 0.7), Math.abs(x - 1.3))).toBeLessThan(EPS)
    }
  })

  test('stroke：零长度线段不产生顶点', () => {
    const b = new MeshBatch()
    b.stroke(2, 3, 2, 3, 1, 1, 1, 1, 1)
    expect(b.count).toBe(0)
  })

  test('disc：圆心 + 环上点，半径恒定', () => {
    const b = new MeshBatch()
    const seg = 16
    b.disc(5, 7, 2, 2, 0, seg, 1, 0, 0, 1)
    expect(b.count).toBe(seg * 3)
    for (let k = 0; k < b.count; k++) {
      const [x, y] = vertex(b, k)
      const d = Math.sqrt((x - 5) ** 2 + (y - 7) ** 2)
      expect(d < EPS || Math.abs(d - 2) < EPS).toBe(true)
    }
  })

  test('disc：退化尺寸/全透明不产生顶点', () => {
    const b = new MeshBatch()
    b.disc(0, 0, 0, 1, 0, 10, 1, 1, 1, 1)
    b.disc(0, 0, 1, 1, 0, 10, 1, 1, 1, 0)
    expect(b.count).toBe(0)
  })

  test('discGrad：中心顶点为中心色，环顶点为边缘色', () => {
    const b = new MeshBatch()
    b.discGrad(0, 0, 3, 8, 1, 0.5, 0.25, 0.4, 0, 0, 0, 0)
    let center = 0
    let edge = 0
    for (let k = 0; k < b.count; k++) {
      const [x, y, r, g, bl, a] = vertex(b, k)
      const d = Math.sqrt(x * x + y * y)
      if (d < EPS) {
        center++
        expect(r).toBeCloseTo(1, 5)
        expect(g).toBeCloseTo(0.5, 5)
        expect(bl).toBeCloseTo(0.25, 5)
        expect(a).toBeCloseTo(0.4, 5)
      } else {
        edge++
        expect(r).toBeCloseTo(0, 5)
        expect(a).toBeCloseTo(0, 5)
        expect(d).toBeCloseTo(3, 5)
      }
    }
    expect(center).toBe(8)
    expect(edge).toBe(16)
  })

  test('ring：seg 段 stroke 逼近椭圆', () => {
    const b = new MeshBatch()
    b.ring(0, 0, 4, 2, 0, 12, 0.3, 1, 1, 1, 1)
    expect(b.count).toBe(12 * 6)
  })

  test('arc：只覆盖给定角度范围（含线宽外扩余量）', () => {
    const b = new MeshBatch()
    // 四分之一圆弧（0 → π/2，y 向下），半径 2，线宽 0.2 → 外扩 ≤0.1
    b.arc(0, 0, 2, 0, Math.PI / 2, 4, 0.2, 1, 1, 1, 1)
    expect(b.count).toBe(4 * 6)
    for (let k = 0; k < b.count; k++) {
      const [x, y] = vertex(b, k)
      expect(x).toBeGreaterThanOrEqual(-0.11)
      expect(y).toBeGreaterThanOrEqual(-0.11)
      expect(x).toBeLessThanOrEqual(2.11)
      expect(y).toBeLessThanOrEqual(2.11)
    }
  })

  test('dashRing：按周长铺排虚线段', () => {
    const b = new MeshBatch()
    const r = 10 / (Math.PI * 2) // 周长恰为 10
    b.dashRing(0, 0, r, 1.2, 1.4, 0.2, 1, 1, 1, 1)
    // 周期 2.6 → 虚线段起点 s = 0, 2.6, 5.2, 7.8 共 4 段，每段 ≥2 条 stroke
    expect(b.count).toBeGreaterThanOrEqual(4 * 2 * 6)
    expect(b.count).toBeLessThan(4 * 8 * 6)
  })

  test('容量不足时自动扩容且不丢数据', () => {
    const b = new MeshBatch(4)
    for (let i = 0; i < 100; i++) b.rect(i, 0, i + 1, 1, 1, 1, 1, 1)
    expect(b.count).toBe(600)
    expect(b.data.length).toBeGreaterThanOrEqual(600 * VERTEX_STRIDE)
    // 抽查第 50 个矩形首顶点横坐标
    expect(vertex(b, 50 * 6)[0]).toBeCloseTo(50, 5)
  })

  test('polyline：单段与 stroke 几何等价', () => {
    const b1 = new MeshBatch()
    b1.stroke(0, 0, 2, 0, 0.4, 1, 1, 1, 1)
    const b2 = new MeshBatch()
    b2.polyline(new Float32Array([0, 0, 2, 0]), 4, 0.4, 1, 1, 1, 1)
    expect(b2.count).toBe(b1.count)
    for (let k = 0; k < b1.count; k++) expectVertex(b2, k, vertex(b1, k))
  })

  test('polyline：直角转角处斜接相连（外角沿角平分线延伸，无缺口）', () => {
    // 折线 (0,0)→(2,0)→(2,2)，宽 1：
    // 段1 法线 (0,1)，段2 法线 (-1,0)，转角斜接向量 = (-0.5,0.5)
    const b = new MeshBatch()
    b.polyline(new Float32Array([0, 0, 2, 0, 2, 2]), 6, 1, 1, 1, 1, 1)
    expect(b.count).toBe(12)
    const corners = new Set<string>()
    for (let k = 0; k < 12; k++) {
      const [x, y] = vertex(b, k)
      corners.add(`${x.toFixed(4)},${y.toFixed(4)}`)
    }
    expect(corners.has('2.5000,-0.5000')).toBe(true) // 外角斜接顶点
    expect(corners.has('1.5000,0.5000')).toBe(true) // 内角顶点
    expect(corners.has('0.0000,0.5000')).toBe(true) // 首端平头
    expect(corners.has('1.5000,2.0000')).toBe(true) // 末端平头
    expect(corners.has('2.5000,2.0000')).toBe(true)
  })

  test('polyline：共线段连续直通，无冗余折角', () => {
    const b = new MeshBatch()
    b.polyline(new Float32Array([0, 0, 1, 0, 2, 0]), 6, 0.4, 1, 1, 1, 1)
    expect(b.count).toBe(12)
    for (let k = 0; k < 12; k++) {
      const [, y] = vertex(b, k)
      expect(Math.abs(y)).toBeCloseTo(0.2, 5) // 全部顶点在 ±0.2，无外延
    }
  })
  test('reset 只清计数，缓冲复用', () => {
    const b = new MeshBatch()
    b.tri(0, 0, 1, 0, 0, 1, 1, 1, 1, 1)
    const before = b.data
    b.reset()
    expect(b.count).toBe(0)
    b.tri(0, 0, 1, 0, 0, 1, 1, 1, 1, 1)
    expect(b.data).toBe(before)
  })
})
