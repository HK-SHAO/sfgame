import { expect, test } from 'vitest'
import { compileExpr, ExprError } from '../src/game/expr'
import { parseLevelText, validateLevelJson } from '../src/game/level-format'
import { LEVELS } from '../src/game/levels'

test('表达式求值：四则、幂、函数与 x 变量', () => {
  expect(compileExpr('x + 2')(3)).toBe(5)
  expect(compileExpr('2 * 3 + 4')(0)).toBe(10)
  expect(compileExpr('2 ^ 3 ^ 2')(0)).toBe(512)
  expect(compileExpr('-(x - 1)')(5)).toBe(-4)
  expect(compileExpr('clamp(x, 0, 2)')(5)).toBe(2)
  expect(compileExpr('smoothstep(x)')(-1)).toBe(0)
  expect(compileExpr('smoothstep(x)')(0.5)).toBe(0.5)
  expect(compileExpr('smoothstep(x)')(2)).toBe(1)
  expect(compileExpr('step(x, 3)')(3)).toBe(1)
  expect(compileExpr('step(x, 3)')(2.9)).toBe(0)
  expect(compileExpr('abs(x) * sqrt(4) + pow(2, 3)')(-3)).toBe(6 + 8)
  expect(compileExpr('min(x, 4) + max(x, 10)')(6)).toBe(4 + 10)
})

test('表达式语法错误抛出 ExprError', () => {
  expect(() => compileExpr('x +')).toThrow(ExprError)
  expect(() => compileExpr('foo(x)')).toThrow(ExprError)
  expect(() => compileExpr('(x + 1')).toThrow(ExprError)
})

test('YAML 解析 + 校验：非法关卡被拒', () => {
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
  // 缺少 world/budget 也不得抛 TypeError，须返回可读错误清单
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
        'solutions: [{ name: s, sources: [{ x: 1, y: 1, kind: hot }], winTime: 1 }]',
      ].join('\n'),
    ),
  ).toThrow(/world/)
})

test('五个关卡：id 连续、协议一致、可往返序列化', () => {
  expect(LEVELS.map((l) => l.id)).toEqual([1, 2, 3, 4, 5])
  for (const l of LEVELS) {
    expect(l.schema).toBe(1)
    expect(validateLevelJson(l.json)).toEqual([])
    // 完美序列化：解析对象 → 再序列化 → 再解析，语义不变
    const round = parseLevelText(JSON.stringify(l.json))
    expect(round).toEqual(l.json)
  }
})

test('关卡地形高度与设计意图一致（表达式精确、无采样误差）', () => {
  // L1 降落（原 L2）：左浅右深的谷地
  expect(LEVELS[0].ground(0)).toBeCloseTo(42, 5)
  expect(LEVELS[0].ground(30)).toBeCloseTo(50, 5)
  // L2 起飞（原 L1）：谷底 → 高原
  expect(LEVELS[1].ground(36)).toBeCloseTo(48, 5)
  expect(LEVELS[1].ground(48)).toBeCloseTo(22, 5)
  expect(LEVELS[2].ground(0)).toBeCloseTo(30, 5)
  expect(LEVELS[2].ground(36)).toBeCloseTo(22, 5)
  expect(LEVELS[3].ground(42)).toBeCloseTo(20, 5)
  expect(LEVELS[4].ground(0)).toBeCloseTo(30, 5)
  expect(LEVELS[4].ground(38)).toBeCloseTo(24, 5)
  expect(LEVELS[4].ground(60)).toBeCloseTo(18, 5)
})

test('第 3 关：两个站点；第 5 关：三个站点（全部抵达过即过关，顺序无关）', () => {
  expect(LEVELS[2].goals.map((g) => g.x)).toEqual([15, 52])
  expect(LEVELS[4].goals.map((g) => g.x)).toEqual([14, 38, 66])
  // 站点 x 沿航线递增（空间布局，非强制访问顺序）
  for (const l of LEVELS) {
    for (let i = 1; i < l.goals.length; i++) expect(l.goals[i].x).toBeGreaterThan(l.goals[i - 1].x)
  }
})
