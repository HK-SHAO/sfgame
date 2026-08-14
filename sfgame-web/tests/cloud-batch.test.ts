import { expect, test } from 'vitest'
import { Clouds } from '../app/sim/clouds.ts'
import { fillCloudVerts } from '../app/render/cloud-batch.ts'

const world = { w: 76, h: 56 }
const terrain = {
  sample: () => 100,
  normal() {},
}

// P1 回归：守卫曾把"容量"与"朵数"混用（n 数浮点却与 CLOUD_COUNT 比），
// 只渲染第一朵可见云——淡出重生时另一朵满不透明度异地闪现（瞬移观感）
test('P1 回归：全部可见云都写入顶点批（3 朵 = 18 顶点）', () => {
  const c = new Clouds(5, world, terrain)
  for (let i = 0; i < c.count; i++) c.alpha[i] = 1
  const out = new Float32Array(c.count * 36)
  expect(fillCloudVerts(c, out)).toBe(18)
})

test('隐形云跳过且不占容量；守卫按浮点容量钳制', () => {
  const c = new Clouds(5, world, terrain)
  c.alpha[0] = 0
  c.alpha[1] = 1
  c.alpha[2] = 1
  const out = new Float32Array(c.count * 36)
  expect(fillCloudVerts(c, out)).toBe(12)
})

test('P3：云体尺寸随 sqrt(alpha) 缩放（凝结长大/消散缩小，免满尺寸闪现）', () => {
  const c = new Clouds(5, world, terrain)
  c.alpha[0] = 0.25
  const out = new Float32Array(c.count * 36)
  fillCloudVerts(c, out)
  expect(out[0]).toBeCloseTo(c.x[0] - c.radius[0] * 1.5 * 0.5, 5)
  expect(out[1]).toBeCloseTo(c.y[0] - c.radius[0] * 1.1 * 0.5, 5)
})
