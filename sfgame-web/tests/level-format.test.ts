import { expect, test } from 'vitest'
import { compileExpr, ExprError } from '../src/game/expr'
import { parseLevelText, validateLevelJson } from '../src/game/level-format'
import { LEVEL_ERRORS, LEVELS } from '../src/game/levels'

test('表达式求值：四则/幂/函数/x 变量，语法错误抛 ExprError', () => {
  expect(compileExpr('x + 2')(3)).toBe(5)
  expect(compileExpr('2 ^ 3 ^ 2')(0)).toBe(512)
  expect(compileExpr('-(x - 1)')(5)).toBe(-4)
  expect(compileExpr('clamp(x, 0, 2)')(5)).toBe(2)
  expect(compileExpr('smoothstep(x)')(0.5)).toBe(0.5)
  expect(compileExpr('step(x, 3)')(2.9)).toBe(0)
  expect(compileExpr('abs(x) * sqrt(4) + pow(2, 3)')(-3)).toBe(6 + 8)
  expect(() => compileExpr('x +')).toThrow(ExprError)
  expect(() => compileExpr('foo(x)')).toThrow(ExprError)
  expect(() => compileExpr('(x + 1')).toThrow(ExprError)
})

test('YAML 解析 + 校验：非法关卡被可读错误拒绝', () => {
  expect(() => parseLevelText('schema: 1\nid: x\n')).toThrow(/校验失败/)
  expect(() => parseLevelText('schema: 2\nid: 1\n')).toThrow(/schema/)
  expect(() =>
    parseLevelText(
      [
        'schema: 1',
        'id: 1',
        'name: t',
        'tagline: t',
        'win: { title: t, text: t }',
        'world: { w: 76, h: 56, cell: 0.75 }',
        'ground: { expr: "999" }',
        'budget: { hot: 1, cold: 0 }',
        'spawn: { x: 0 }',
        'goals: [{ x: 40, r: 5 }]',
      ].join('\n'),
    ),
  ).toThrow(/世界高度/)
  expect(() =>
    parseLevelText(
      [
        'schema: 1',
        'id: 1',
        'name: t',
        'tagline: t',
        'win: { title: t, text: t }',
        'ground: { expr: "30" }',
        'spawn: { x: 0 }',
        'goals: [{ x: 40, r: 5 }]',
      ].join('\n'),
    ),
  ).toThrow(/world/)
  expect(() =>
    parseLevelText(
      [
        'schema: 1',
        'id: 1',
        'name: t',
        'tagline: t',
        'win: { title: t, text: t }',
        'world: { w: 76, h: 56, cell: 0.75 }',
        'ground: { expr: "40" }',
        'budget: { hot: 1, cold: 0 }',
        'spawn: { x: 0 }',
        'goals: [{ x: 40, r: 0 }]',
      ].join('\n'),
    ),
  ).toThrow(/goals/)
})

test('仓库关卡全部合法，协议一致且可往返序列化', () => {
  expect(LEVELS.map((l) => l.id)).toEqual([1, 2, 3, 4, 5])
  expect(LEVEL_ERRORS).toEqual([])
  for (const l of LEVELS) {
    expect(l.schema).toBe(1)
    expect(validateLevelJson(l.json)).toEqual([])
    expect(parseLevelText(JSON.stringify(l.json))).toEqual(l.json)
  }
})
