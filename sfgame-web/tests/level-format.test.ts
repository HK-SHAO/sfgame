import { expect, test } from 'vitest'
import { parseLevelText } from '../app/game/level-format.ts'
import { validateLevelJson } from '../app/game/level-validate.ts'
import { LEVEL_ERRORS, LEVEL_GROUPS, LEVELS, isUnlocked, nextLevel } from '../app/game/levels.ts'
import { compileSdf, SdfError } from '../app/game/sdf.ts'

test('SDF 表达式求值：四则/函数/x、y 变量，语法错误抛 SdfError', () => {
  expect(compileSdf('x + 2')(3, 0)).toBe(5)
  expect(compileSdf('-(x - 1)')(5, 0)).toBe(-4)
  expect(compileSdf('y - x')(3, 10)).toBe(7)
  expect(compileSdf('clamp(x, 0, 2)')(5, 0)).toBe(2)
  expect(compileSdf('smoothstep(x)')(0.5, 0)).toBe(0.5)
  expect(compileSdf('abs(x) * sqrt(4)')(3, 0)).toBe(6)
  expect(compileSdf('min(x, y)')(3, 7)).toBe(3)
  // 数字字面量形态（.5/科学计数法）
  expect(compileSdf('.5')(0, 0)).toBe(0.5)
  expect(compileSdf('1e3')(0, 0)).toBe(1000)
  expect(compileSdf('2.5e-1')(0, 0)).toBe(0.25)
  // 幂/取模不进词法（避免 ^ 歧义与非距离语义）
  expect(() => compileSdf('x ^ 2')).toThrow(SdfError)
  expect(() => compileSdf('x % 2')).toThrow(SdfError)
  expect(() => compileSdf('x +')).toThrow(SdfError)
  expect(() => compileSdf('foo(x)')).toThrow(SdfError)
  expect(() => compileSdf('(x + 1')).toThrow(SdfError)
})

test('SDF 原语：精确距离场（flat/circle/box/capsule）与光滑并/交（smin/smax）', () => {
  expect(compileSdf('flat(40)')(3, 38)).toBe(2)
  expect(compileSdf('circle(20, 30, 5)')(20, 38)).toBe(3)
  expect(compileSdf('circle(20, 30, 5)')(20, 30)).toBe(-5)
  expect(compileSdf('box(10, 20, 3, 4)')(10, 27)).toBe(3)
  expect(compileSdf('box(10, 20, 3, 4)')(10, 20)).toBe(-3)
  expect(compileSdf('capsule(0, 10, 10, 10, 2)')(5, 14)).toBe(2)
  // 光滑并 = 硬并的平滑极限：地表上方的圆丘熔入地面；挖洞 = smax(a, −b, k)
  expect(compileSdf('smin(flat(40), circle(20, 30, 5), 0.0001)')(20, 32)).toBeCloseTo(-3, 3)
  expect(compileSdf('smax(flat(40), -circle(20, 42, 5), 0.0001)')(20, 42)).toBeCloseTo(5, 3)
  // 非法参数在求值期拒绝（编译期只查语法）
  expect(() => compileSdf('circle(0, 0, 0)')(0, 0)).toThrow(SdfError)
  expect(() => compileSdf('box(0, 0, 1, 0)')(0, 0)).toThrow(SdfError)
  expect(() => compileSdf('capsule(0, 0, 1, 1, -1)')(0, 0)).toThrow(SdfError)
  expect(() => compileSdf('smin(flat(40), flat(30), 0)')(0, 0)).toThrow(SdfError)
})

test('地形原子：smoothstep 三参 GLSL 兼容，bump/gauss 山丘', () => {
  const ss = (e0: number, e1: number, x: number) => compileSdf(`smoothstep(${e0}, ${e1}, x)`)(x, 0)
  expect(ss(0, 1, 0.5)).toBe(0.5)
  expect(ss(0, 1, 0)).toBe(0)
  expect(ss(0, 1, 1)).toBe(1)
  expect(ss(0, 1, -2)).toBe(0)
  expect(ss(0, 1, 3)).toBe(1)
  expect(ss(0, 2, 1)).toBe(0.5)
  expect(() => ss(1, 1, 0.5)).toThrow(SdfError)
  expect(() => ss(2, 1, 0.5)).toThrow(SdfError)
  expect(() => compileSdf('smoothstep(x, 2)')(0, 0)).toThrow(SdfError)
  expect(compileSdf('smoothstep(x)')(0.5, 0)).toBe(0.5)
  // ss 别名与 smoothstep 等价（1 参与 3 参）
  expect(compileSdf('ss(x)')(0.5, 0)).toBe(compileSdf('smoothstep(x)')(0.5, 0))
  expect(compileSdf('ss(0, 2, x)')(1, 0)).toBe(compileSdf('smoothstep(0, 2, x)')(1, 0))
  const b = compileSdf('bump(20, 5, 12)')
  expect(b(20, 0)).toBe(12)
  expect(b(15, 0)).toBe(0)
  expect(b(25, 0)).toBe(0)
  expect(b(17.5, 0)).toBe(6)
  expect(b(22.5, 0)).toBe(6)
  const g = compileSdf('gauss(30, 4, 10)')
  expect(g(30, 0)).toBe(10)
  expect(g(34, 0)).toBeCloseTo(10 * Math.exp(-1))
  expect(g(42, 0)).toBeCloseTo(0)
  expect(() => compileSdf('bump(20, 0, 5)')(0, 0)).toThrow(/w/)
  expect(() => compileSdf('gauss(20, -1, 5)')(0, 0)).toThrow(/w/)
  expect(() => compileSdf('bump(20)')(0, 0)).toThrow(SdfError)
  expect(() => compileSdf('gauss(20, 5)')(0, 0)).toThrow(SdfError)
})

test('JSON 解析 + 校验：非法关卡被可读错误拒绝', () => {
  expect(() => parseLevelText('{"id":"bad id"}')).toThrow(/slug/)
  // $schema 仅编辑器提示：错版引用不拒绝（schema 与运行时解耦）
  expect(
    parseLevelText(
      '{"$schema":"https://sf.game.shao.fun/level.schema-999.json","id":"lv-1","name":"t","tagline":"t","win":{"title":"t","text":"t"},"world":{"w":76,"h":56,"cell":0.75},"terrain":{"sdf":"40 - y"},"budget":{"hot":1,"cold":0},"spawn":{"x":0},"goals":[{"x":40,"r":5}]}',
    ),
  ).toMatchObject({ id: 'lv-1' })
  const json = (o: object) => JSON.stringify(o)
  expect(() =>
    parseLevelText(
      json({
        id: 'lv-1', name: 't', tagline: 't', win: { title: 't', text: 't' },
        world: { w: 76, h: 56, cell: 0.75 }, terrain: { sdf: '40 - y +' },
        budget: { hot: 1, cold: 0 }, spawn: { x: 0 }, goals: [{ x: 40, r: 5 }],
      }),
    ),
  ).toThrow(/语法错误/)
  expect(() =>
    parseLevelText(
      json({
        id: 'lv-1', name: 't', tagline: 't', win: { title: 't', text: 't' },
        terrain: { sdf: '40 - y' }, spawn: { x: 0 }, goals: [{ x: 40, r: 5 }],
      }),
    ),
  ).toThrow(/world/)
  expect(() =>
    parseLevelText(
      json({
        id: 'lv-1', name: 't', tagline: 't', win: { title: 't', text: 't' },
        world: { w: 76, h: 56, cell: 0.75 }, terrain: { sdf: '40 - y' },
        budget: { hot: 1, cold: 0 }, spawn: { x: 0 }, goals: [{ x: 40, r: 0 }],
      }),
    ),
  ).toThrow(/goals/)
  // 固/气共存校验：无实体（永不着地）与全实体（无处可飞）皆被拒
  expect(() =>
    parseLevelText(
      json({
        id: 'lv-1', name: 't', tagline: 't', win: { title: 't', text: 't' },
        world: { w: 76, h: 56, cell: 0.75 }, terrain: { sdf: '999 - y' },
        budget: { hot: 1, cold: 0 }, spawn: { x: 0 }, goals: [{ x: 40, r: 5 }],
      }),
    ),
  ).toThrow(/无实体/)
  expect(() =>
    parseLevelText(
      json({
        id: 'lv-1', name: 't', tagline: 't', win: { title: 't', text: 't' },
        world: { w: 76, h: 56, cell: 0.75 }, terrain: { sdf: '-y' },
        budget: { hot: 1, cold: 0 }, spawn: { x: 0 }, goals: [{ x: 40, r: 5 }],
      }),
    ),
  ).toThrow(/全为实体/)
})

test('仓库关卡全部合法，协议一致且可往返序列化', () => {
  expect(LEVELS.map((l) => l.id)).toEqual([
    'luo-yu', 'fu-yao', 'xin-feng', 'chao-xi', 'hui-gui',
    'ying-huo', 'bing-jiao', 'gu-feng', 'zhong-bai', 'fen-feng',
    'chu-shuang', 'ni-lu', 'ji-bai', 'zhuo-yuan', 'tian-qian',
    'zhui-xing', 'hui-yin', 'tian-ti', 'chuan-tang', 'gui-xu',
  ])
  expect(LEVEL_ERRORS).toEqual([])
  for (const l of LEVELS) {
    expect(validateLevelJson(l.json)).toEqual([])
    expect(parseLevelText(JSON.stringify(l.json))).toEqual(l.json)
  }
})

test('关卡图：组名与组内顺序（TS 声明，JSON 不携带）', () => {
  expect(LEVEL_GROUPS.map((g) => [g.name, [...g.ids]])).toEqual([
    ['长风', ['luo-yu', 'fu-yao', 'xin-feng', 'chao-xi', 'hui-gui']],
    ['焚风', ['ying-huo', 'bing-jiao', 'gu-feng', 'zhong-bai', 'fen-feng']],
    ['烈风', ['chu-shuang', 'ni-lu', 'ji-bai', 'zhuo-yuan', 'tian-qian']],
    ['罡风', ['zhui-xing', 'hui-yin', 'tian-ti', 'chuan-tang', 'gui-xu']],
  ])
})

test('解锁语义：每组首关初始解锁；其余 = 上一关或本关有记录，跨组独立', () => {
  const done = new Set<string>()
  const completed = (id: string) => done.has(id)
  // 两组首关（luo-yu 与 ying-huo）初始皆解锁
  expect(isUnlocked('luo-yu', completed)).toBe(true)
  expect(isUnlocked('ying-huo', completed)).toBe(true)
  // 组内前驱解锁：完成 chao-xi → 解锁 hui-gui；未完成 hui-gui → ying-huo 仍解锁（跨组独立）
  expect(isUnlocked('fu-yao', completed)).toBe(false)
  done.add('luo-yu')
  expect(isUnlocked('fu-yao', completed)).toBe(true)
  expect(isUnlocked('hui-gui', completed)).toBe(false)
  done.add('chao-xi')
  expect(isUnlocked('hui-gui', completed)).toBe(true)
  // 本关记录兜底：跳过前驱、直接有本关记录也解锁
  done.clear()
  done.add('xin-feng')
  expect(isUnlocked('xin-feng', completed)).toBe(true)
  expect(isUnlocked('fu-yao', completed)).toBe(false)
  // 不在任何组的 id 不可解锁
  expect(isUnlocked('not-a-level', completed)).toBe(false)
})

test('下一关导航：组内顺延，组尾跨入下一组首关，最后一关无下一关', () => {
  expect(nextLevel('luo-yu')).toBe('fu-yao')
  expect(nextLevel('hui-gui')).toBe('ying-huo')
  expect(nextLevel('ying-huo')).toBe('bing-jiao')
  expect(nextLevel('fen-feng')).toBe('chu-shuang')
  expect(nextLevel('zhuo-yuan')).toBe('tian-qian')
  expect(nextLevel('tian-qian')).toBe('zhui-xing')
  expect(nextLevel('chuan-tang')).toBe('gui-xu')
  expect(nextLevel('gui-xu')).toBeUndefined()
  expect(nextLevel('not-a-level')).toBeUndefined()
})

test('新原子校验：fixed/fans 合法放行、非法被拒', () => {
  const json = (o: object) => JSON.stringify(o)
  const base = {
    id: 'lv-20', name: 't', tagline: 't', win: { title: 't', text: 't' },
    world: { w: 76, h: 56, cell: 0.75 }, terrain: { sdf: '40 - y' },
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
    id: 'lv-21', name: 't', tagline: 't', win: { title: 't', text: 't' },
    world: { w: 76, h: 56, cell: 0.75 }, terrain: { sdf: '40 - y' },
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

test('顶层未知字段拒绝、错误带精确路径与实值', () => {
  const json = (o: object) => JSON.stringify(o)
  const base = {
    id: 'lv-22', name: 't', tagline: 't', win: { title: 't', text: 't' },
    world: { w: 76, h: 56, cell: 0.75 }, terrain: { sdf: '40 - y' },
    budget: { hot: 1, cold: 0 }, spawn: { x: 0 }, goals: [{ x: 40, r: 5 }],
  }
  // 合法放行；未知顶层字段（笔误）被拒
  const j = parseLevelText(json(base)) as unknown as Record<string, unknown>
  expect(validateLevelJson(j)).toEqual([])
  const clone = structuredClone(j)
  clone.budet = 3
  expect(validateLevelJson(clone).join('\n')).toMatch(/未知字段 "budet"/)
  // 路径 + 实值：单字段定位，报出实际值
  const bad = (mut: (x: Record<string, unknown>) => void) => {
    const c = structuredClone(j)
    mut(c)
    return validateLevelJson(c).join('\n')
  }
  expect(bad((x) => ((x.goals as object[])[0] as Record<string, unknown>).r = 20)).toMatch(/goals\[0\]\.r = 20，需 ≤ 15/)
  expect(bad((x) => ((x.goals as object[])[0] as Record<string, unknown>).x = 99)).toMatch(/goals\[0\]\.x = 99，需 ≤ 76/)
  // world 非法时下游只查结构：不级联误报动态边界
  const broken = structuredClone(j)
  broken.world = { w: -1, h: 56, cell: 0.75 }
  const errs = validateLevelJson(broken).join('\n')
  expect(errs).toMatch(/world\.w = -1，需 > 0/)
  expect(errs).not.toMatch(/goals\[/)
})
