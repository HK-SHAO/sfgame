import { expect, test } from 'vitest'
import { compileExpr, ExprError } from '../app/game/expr'
import { parseLevelText, validateLevelJson } from '../app/game/level-format'
import { LEVEL_ERRORS, LEVEL_GROUPS, LEVELS, isUnlocked, nextLevel } from '../app/game/levels'

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

test('地形原子：smoothstep 三参 GLSL 兼容，bump/gauss 山丘', () => {
  const ss = (e0: number, e1: number, x: number) => compileExpr(`smoothstep(${e0}, ${e1}, x)`)(x)
  expect(ss(0, 1, 0.5)).toBe(0.5)
  expect(ss(0, 1, 0)).toBe(0)
  expect(ss(0, 1, 1)).toBe(1)
  expect(ss(0, 1, -2)).toBe(0)
  expect(ss(0, 1, 3)).toBe(1)
  expect(ss(0, 2, 1)).toBe(0.5)
  expect(() => ss(1, 1, 0.5)).toThrow(ExprError)
  expect(() => ss(2, 1, 0.5)).toThrow(ExprError)
  expect(() => compileExpr('smoothstep(x, 2)')(0)).toThrow(ExprError)
  expect(compileExpr('smoothstep(x)')(0.5)).toBe(0.5)
  // ss 别名与 smoothstep 等价（1 参与 3 参）
  expect(compileExpr('ss(x)')(0.5)).toBe(compileExpr('smoothstep(x)')(0.5))
  expect(compileExpr('ss(0, 2, x)')(1)).toBe(compileExpr('smoothstep(0, 2, x)')(1))
  const b = compileExpr('bump(20, 5, 12)')
  expect(b(20)).toBe(12)
  expect(b(15)).toBe(0)
  expect(b(25)).toBe(0)
  expect(b(17.5)).toBe(6)
  expect(b(22.5)).toBe(6)
  const g = compileExpr('gauss(30, 4, 10)')
  expect(g(30)).toBe(10)
  expect(g(34)).toBeCloseTo(10 * Math.exp(-1))
  expect(g(42)).toBeCloseTo(0)
  expect(() => compileExpr('bump(20, 0, 5)')(0)).toThrow(/w/)
  expect(() => compileExpr('gauss(20, -1, 5)')(0)).toThrow(/w/)
  expect(() => compileExpr('bump(20)')(0)).toThrow(ExprError)
  expect(() => compileExpr('gauss(20, 5)')(0)).toThrow(ExprError)
})

test('JSON 解析 + 校验：非法关卡被可读错误拒绝', () => {
  expect(() => parseLevelText('{"schema":1,"id":"x"}')).toThrow(/校验失败/)
  expect(() => parseLevelText('{"schema":2,"id":1}')).toThrow(/schema/)
  const json = (o: object) => JSON.stringify(o)
  expect(() =>
    parseLevelText(
      json({
        schema: 1, id: 1, name: 't', tagline: 't', win: { title: 't', text: 't' },
        world: { w: 76, h: 56, cell: 0.75 }, ground: { expr: '999' },
        budget: { hot: 1, cold: 0 }, spawn: { x: 0 }, goals: [{ x: 40, r: 5 }],
      }),
    ),
  ).toThrow(/世界高度/)
  expect(() =>
    parseLevelText(
      json({
        schema: 1, id: 1, name: 't', tagline: 't', win: { title: 't', text: 't' },
        ground: { expr: '30' }, spawn: { x: 0 }, goals: [{ x: 40, r: 5 }],
      }),
    ),
  ).toThrow(/world/)
  expect(() =>
    parseLevelText(
      json({
        schema: 1, id: 1, name: 't', tagline: 't', win: { title: 't', text: 't' },
        world: { w: 76, h: 56, cell: 0.75 }, ground: { expr: '40' },
        budget: { hot: 1, cold: 0 }, spawn: { x: 0 }, goals: [{ x: 40, r: 0 }],
      }),
    ),
  ).toThrow(/goals/)
  expect(() =>
    parseLevelText(
      json({
        schema: 1, id: 1, name: 't', tagline: 't', win: { title: 't', text: 't' },
        world: { w: 76, h: 56, cell: 0.75 }, ground: { expr: 'bump(20, 0, 5)' },
        budget: { hot: 1, cold: 0 }, spawn: { x: 0 }, goals: [{ x: 40, r: 5 }],
      }),
    ),
  ).toThrow(/求值错误/)
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

test('关卡图：组名与组内顺序（TS 声明，JSON 不携带）', () => {
  expect(LEVEL_GROUPS.map((g) => [g.name, [...g.ids]])).toEqual([
    ['长风', [1, 2, 3, 4, 5]],
    ['焚风', [6, 7, 8, 9, 10]],
  ])
})

test('解锁语义：每组首关初始解锁；其余 = 上一关或本关有记录，跨组独立', () => {
  const done = new Set<number>()
  const completed = (id: number) => done.has(id)
  // 两组首关（1 与 6）初始皆解锁
  expect(isUnlocked(1, completed)).toBe(true)
  expect(isUnlocked(6, completed)).toBe(true)
  // 组内前驱解锁：完成 4 → 解锁 5；未完成 5 → 6 仍解锁（跨组独立）
  expect(isUnlocked(2, completed)).toBe(false)
  done.add(1)
  expect(isUnlocked(2, completed)).toBe(true)
  expect(isUnlocked(5, completed)).toBe(false)
  done.add(4)
  expect(isUnlocked(5, completed)).toBe(true)
  // 本关记录兜底：跳过前驱、直接有本关记录也解锁
  done.clear()
  done.add(3)
  expect(isUnlocked(3, completed)).toBe(true)
  expect(isUnlocked(2, completed)).toBe(false)
  // 不在任何组的 id 不可解锁
  expect(isUnlocked(99, completed)).toBe(false)
})

test('下一关导航：组内顺延，组尾跨入下一组首关，最后一关无下一关', () => {
  expect(nextLevel(1)).toBe(2)
  expect(nextLevel(5)).toBe(6)
  expect(nextLevel(6)).toBe(7)
  expect(nextLevel(10)).toBeUndefined()
  expect(nextLevel(99)).toBeUndefined()
})

test('新原子校验：fixed/fans 合法放行、非法被拒', () => {
  const json = (o: object) => JSON.stringify(o)
  const base = {
    schema: 1, id: 20, name: 't', tagline: 't', win: { title: 't', text: 't' },
    world: { w: 76, h: 56, cell: 0.75 }, ground: { expr: '40' },
    budget: { hot: 1, cold: 0 }, spawn: { x: 0 }, goals: [{ x: 40, r: 5 }],
  }
  const ok = (extra: object) => expect(validateLevelJson(parseLevelText(json({ ...base, ...extra })))).toEqual([])
  ok({ fixed: [{ x: 10, y: 20, kind: 'hot' }] })
  ok({ fixed: [{ x: 10, y: 20, kind: 'cold', power: 1.5 }] })
  ok({ fans: [{ x: 10, y: 20, dir: 0, power: 2, swing: 0.5, period: 6 }] })
  const j = parseLevelText(json(base)) as unknown as Record<string, unknown>
  const bad = (mut: (x: Record<string, unknown>) => void, re: RegExp) => {
    const clone = structuredClone(j)
    mut(clone)
    expect(validateLevelJson(clone).join('；')).toMatch(re)
  }
  bad((x) => (x.fixed = [{ x: 10, y: 20, kind: 'warm' }]), /fixed/)
  bad((x) => (x.fixed = [{ x: -1, y: 20, kind: 'hot' }]), /fixed/)
  bad((x) => (x.fixed = [{ x: 10, y: 20, kind: 'hot', power: 0 }]), /power/)
  bad((x) => (x.fixed = [{ x: 10, y: 20, kind: 'hot', power: -2 }]), /power/)
  bad((x) => (x.fixed = [{ x: 10, y: 20, kind: 'hot', power: 'x' }]), /power/)
  bad((x) => (x.fans = [{ x: 10, y: 20, dir: 0, power: 0 }]), /fans/)
  bad((x) => (x.fans = [{ x: 10, y: 20, dir: 0, power: 2, swing: 4 }]), /swing/)
  bad((x) => (x.fans = [{ x: 10, y: 20, dir: 0, power: 2, period: -1 }]), /period/)
})

test('ambient.temp 校验：[-10, 10] 内放行，越界/非数值被拒', () => {
  const json = (o: object) => JSON.stringify(o)
  const base = {
    schema: 1, id: 21, name: 't', tagline: 't', win: { title: 't', text: 't' },
    world: { w: 76, h: 56, cell: 0.75 }, ground: { expr: '40' },
    budget: { hot: 1, cold: 0 }, spawn: { x: 0 }, goals: [{ x: 40, r: 5 }],
  }
  const ok = (extra: object) => expect(validateLevelJson(parseLevelText(json({ ...base, ...extra })))).toEqual([])
  ok({ ambient: { x: 1, y: 0, temp: 0.5 } })
  ok({ ambient: { x: 1, y: 0, temp: -1 } })
  ok({ ambient: { x: 1, y: 0, temp: 10 } })
  ok({ ambient: { x: 1, y: 0, temp: -10 } })
  ok({ ambient: { x: 1, y: 0 } })
  const j = parseLevelText(json(base)) as unknown as Record<string, unknown>
  const bad = (mut: (x: Record<string, unknown>) => void, re: RegExp) => {
    const clone = structuredClone(j)
    mut(clone)
    expect(validateLevelJson(clone).join('；')).toMatch(re)
  }
  bad((x) => (x.ambient = { x: 1, y: 0, temp: 10.5 }), /temp/)
  bad((x) => (x.ambient = { x: 1, y: 0, temp: -11 }), /temp/)
  bad((x) => (x.ambient = { x: 1, y: 0, temp: 'hot' }), /temp/)
})
