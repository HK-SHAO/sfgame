import { expect, test } from 'vitest'
import { compileExpr, ExprError } from '../app/game/expr'
import { parseLevelText, validateLevelJson } from '../app/game/level-format'
import { LEVEL_ERRORS, LEVEL_GROUPS, LEVELS } from '../app/game/levels'

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
  expect(LEVELS.map((l) => l.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  expect(LEVEL_ERRORS).toEqual([])
  for (const l of LEVELS) {
    expect(l.schema).toBe(1)
    expect(validateLevelJson(l.json)).toEqual([])
    expect(parseLevelText(JSON.stringify(l.json))).toEqual(l.json)
  }
})

test('关卡组聚合：按字符串组名分组，组内按 id 升序', () => {
  expect(LEVEL_GROUPS.map((g) => [g.name, g.levels.length])).toEqual([
    ['长风', 5],
    ['焚风', 5],
  ])
})

test('新原子校验：fixed/fans/group 合法放行、非法被拒', () => {
  const base = [
    'schema: 1',
    'id: 20',
    'group: 测试',
    'name: t',
    'tagline: t',
    'win: { title: t, text: t }',
    'world: { w: 76, h: 56, cell: 0.75 }',
    'ground: { expr: "40" }',
    'budget: { hot: 1, cold: 0 }',
    'spawn: { x: 0 }',
    'goals: [{ x: 40, r: 5 }]',
  ]
  const ok = (extra: string) => expect(validateLevelJson(parseLevelText([...base, extra].join('\n')))).toEqual([])
  ok('fixed:\n  - { x: 10, y: 20, kind: hot }')
  ok('fans:\n  - { x: 10, y: 20, dir: 0, power: 2, swing: 0.5, period: 6 }')
  const j = parseLevelText(base.join('\n')) as unknown as Record<string, unknown>
  const bad = (mut: (x: Record<string, unknown>) => void, re: RegExp) => {
    const clone = structuredClone(j)
    mut(clone)
    expect(validateLevelJson(clone).join('；')).toMatch(re)
  }
  bad((x) => (x.group = ''), /group/)
  bad((x) => (x.group = '  '), /group/)
  bad((x) => (x.group = 2), /group/)
  bad((x) => (x.group = { id: 2, name: 'x' }), /group/)
  bad((x) => delete x.group, /group/)
  bad((x) => (x.fixed = [{ x: 10, y: 20, kind: 'warm' }]), /fixed/)
  bad((x) => (x.fixed = [{ x: -1, y: 20, kind: 'hot' }]), /fixed/)
  bad((x) => (x.fans = [{ x: 10, y: 20, dir: 0, power: 0 }]), /fans/)
  bad((x) => (x.fans = [{ x: 10, y: 20, dir: 0, power: 2, swing: 4 }]), /swing/)
  bad((x) => (x.fans = [{ x: 10, y: 20, dir: 0, power: 2, period: -1 }]), /period/)
})
