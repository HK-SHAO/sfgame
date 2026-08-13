// SDF 求值器 golden 基线：纯 TS 实现（app/game/sdf.ts）输出对基线逐位一致——
// 地形表达式直接决定碰撞/渲染烘焙结果，任何语义漂移（解析/求值/NaN 边角）都必须响亮失败。
// 确定性算术（四则/min/max/abs/sqrt/smoothstep/smin/smax）逐位钉死（toBe）；
// trig/exp 走原生 Math（跨引擎 ≤1 ulp，经 f32 烘焙场存储后被抹平），标 approx 用容差守护语义漂移
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { compileSdf, SdfError } from '../app/game/sdf.ts'

interface Golden {
  grid: [number, number][]
  cases: { expr: string; values: number[]; approx?: boolean; near?: [number, number][]; nearValues?: number[] }[]
}

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL('./sdf-golden.json', import.meta.url)), 'utf8'),
) as Golden

test('SDF golden 基线：确定性算术逐位一致 + trig/exp 容差一致', () => {
  for (const c of golden.cases) {
    const f = compileSdf(c.expr)
    golden.grid.forEach(([x, y], i) => {
      const got = f(x, y)
      if (c.approx) expect(got, `${c.expr} @(${x},${y})`).toBeCloseTo(c.values[i], 12)
      else expect(got, `${c.expr} @(${x},${y})`).toBe(c.values[i])
    })
    // 近场采样：共享网格只覆盖远场角落（形状近场/smin/smax 混合带/ss 过渡区在此钉死，
    // 求值器只在这些区域漂移时，远场网格不报警）
    ;(c.near ?? []).forEach(([x, y], i) => {
      const got = f(x, y)
      const want = c.nearValues![i]
      if (c.approx) expect(got, `${c.expr} near@(${x},${y})`).toBeCloseTo(want, 12)
      else expect(got, `${c.expr} near@(${x},${y})`).toBe(want)
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
