// SDF 求值器 golden 基线：moon/sdf（js 目标）输出对 TS 原实现基线（tests/sdf-golden.json，
// 迁移前捕获）逐位一致——地形表达式直接决定碰撞/渲染烘焙结果，且 js 目标 Math.* 直通，
// 任何语义漂移（解析/求值/NaN 边角）都必须响亮失败
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { compileSdf, SdfError } from '../app/game/sdf.ts'

interface Golden {
  grid: [number, number][]
  cases: { expr: string; values: number[] }[]
}

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL('./sdf-golden.json', import.meta.url)), 'utf8'),
) as Golden

test('SDF golden 基线：10 表达式全网格逐位一致', () => {
  for (const c of golden.cases) {
    const f = compileSdf(c.expr)
    golden.grid.forEach(([x, y], i) => {
      expect(f(x, y), `${c.expr} @(${x},${y})`).toBe(c.values[i])
    })
  }
})

test('SDF 错误消息经门面包装为 SdfError 且正文保留', () => {
  expect(() => compileSdf('x ^ 2')).toThrow(SdfError)
  expect(() => compileSdf('foo(x)')).toThrow(SdfError)
  // 实参语义错误在求值期抛出（编译期仅语法检查）
  expect(() => compileSdf('circle(0, 0, -1)')(1, 1)).toThrowError('circle 半径必须 > 0')
  expect(() => compileSdf('bump(0, 0, 1)')(0, 0)).toThrowError('bump 半宽 w 必须 > 0')
})
