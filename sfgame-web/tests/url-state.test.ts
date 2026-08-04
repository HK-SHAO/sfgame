import { expect, test } from 'vitest'
import {
  UrlState,
  codecs,
  type UrlStateListCodec,
  type UrlStateSource,
} from '../src/core/url-state'

/** 内存假源：模拟 location.search + pushState + popstate。 */
function fakeSource(initial = '') {
  let params = new URLSearchParams(initial)
  const pushes: string[] = []
  let cb: (() => void) | null = null
  return {
    source: {
      getParams: () => new URLSearchParams(params),
      pushState: (p: URLSearchParams) => {
        params = new URLSearchParams(p)
        pushes.push(params.toString())
      },
      onChange: (f: () => void) => {
        cb = f
        return () => {
          cb = null
        }
      },
    } as UrlStateSource,
    pushes,
    /** 模拟浏览器前进/后退：改 URL 并触发 popstate */
    applyUrl(url: string) {
      params = new URLSearchParams(url)
      cb?.()
    },
  }
}

const pair: UrlStateListCodec<[number, number]> = {
  encode: ([a, b]) => `${a}:${b}`,
  decode: (raw) => {
    const [as, bs] = raw.split(':')
    const a = Number(as)
    const b = Number(bs)
    return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null
  },
}

const def = {
  level: codecs.int(null, 1, 99),
  count: codecs.int(5, 0, 10),
  flag: codecs.bool(false),
  pairs: codecs.list<[number, number]>([], pair, ';'),
}

type Def = typeof def

function make(initial = '') {
  const fake = fakeSource(initial)
  const state = new UrlState<Def>(def, fake.source)
  return { state, fake }
}

const flush = () => new Promise<void>((r) => queueMicrotask(() => r()))

test('初始解码：合法参数生效', () => {
  const { state } = make('level=2&flag=1&pairs=1:2;3:4')
  expect(state.get('level')).toBe(2)
  expect(state.get('count')).toBe(5)
  expect(state.get('flag')).toBe(true)
  expect(state.get('pairs')).toEqual([
    [1, 2],
    [3, 4],
  ])
})

test('非法/缺失值回落默认，非法列表元素丢弃', () => {
  const { state } = make('level=abc&level2=1&count=99&flag=maybe&pairs=1:2;bad;x:y')
  expect(state.get('level')).toBeNull()
  expect(state.get('count')).toBe(5)
  expect(state.get('flag')).toBe(false)
  expect(state.get('pairs')).toEqual([[1, 2]])
})

test('set 按微任务批量写入：同帧多次 set 只 pushState 一次', async () => {
  const { state, fake } = make('')
  state.set('level', 1)
  state.set('count', 3)
  state.set('flag', true)
  expect(fake.pushes).toHaveLength(0)
  await flush()
  expect(fake.pushes).toHaveLength(1)
  // URLSearchParams 按插入序序列化
  expect(fake.pushes[0]).toBe('level=1&count=3&flag=1')
  expect(state.get('level')).toBe(1)
})

test('等值 set 跳过：不重复写 URL、不触发通知', async () => {
  const { state, fake } = make('level=2')
  let notified = 0
  state.onChange('level', () => notified++)
  state.set('level', 2)
  await flush()
  expect(fake.pushes).toHaveLength(0)
  expect(notified).toBe(0)
})

test('写读分离：set/clear 不回调订阅者，onChange 仅响应外部 URL 变化', async () => {
  const { state, fake } = make('')
  let n = 0
  state.onChange('count', () => n++)
  state.set('count', 3)
  await flush()
  expect(n).toBe(0) // 写方自知：本模块写入不触发订阅者
  state.clear('count')
  await flush()
  expect(n).toBe(0)
  fake.applyUrl('count=4') // 浏览器后退/前进才触发
  expect(n).toBe(1)
  expect(state.get('count')).toBe(4)
})

test('clear 移除键并回落默认', async () => {
  const { state, fake } = make('level=2&count=3')
  state.clear('level')
  expect(state.get('level')).toBeNull()
  await flush()
  expect(fake.pushes[0]).toBe('count=3')
})

test('外部 URL 变化（后退/前进）同步状态并通知订阅者', () => {
  const { state, fake } = make('level=1')
  const seen: Array<number | null> = []
  state.onChange('level', (v) => seen.push(v))
  fake.applyUrl('level=2')
  expect(state.get('level')).toBe(2)
  expect(seen).toEqual([2])
  fake.applyUrl('') // 回到无参数页（标题）
  expect(state.get('level')).toBeNull()
  expect(seen).toEqual([2, null])
})

test('同步阶段读取一致：popstate 时任何键都是最新值', () => {
  const { state, fake } = make('level=1&count=3')
  let levelAtCallback: number | null = -1
  state.onChange('level', () => {
    levelAtCallback = state.get('count')
  })
  fake.applyUrl('level=2&count=7')
  expect(levelAtCallback).toBe(7)
})

test('订阅退订生效', () => {
  const { state, fake } = make('')
  let n = 0
  const off = state.onChange('count', () => n++)
  fake.applyUrl('count=3')
  off()
  fake.applyUrl('count=4')
  expect(n).toBe(1)
})

test('未知键原样保留，不干扰已知键', async () => {
  const { state, fake } = make('dev=1&utm=abc')
  state.set('level', 1)
  await flush()
  expect(fake.pushes[0]).toBe('dev=1&utm=abc&level=1')
})

test('枚举编解码：合法值生效，未知/缺失回落默认', async () => {
  const enumDef = { view: codecs.enum<'a' | 'b'>('a', ['a', 'b']) }
  type EnumDef = typeof enumDef
  const { state, fake } = (() => {
    const f = fakeSource('')
    return { state: new UrlState<EnumDef>(enumDef, f.source), fake: f }
  })()
  expect(state.get('view')).toBe('a')
  state.set('view', 'b')
  expect(state.get('view')).toBe('b')
  await flush()
  expect(fake.pushes[0]).toBe('view=b')
  const f2 = fakeSource('view=x&view2=1')
  const s2 = new UrlState<EnumDef>(enumDef, f2.source)
  expect(s2.get('view')).toBe('a')
  const f3 = fakeSource('view=b')
  const s3 = new UrlState<EnumDef>(enumDef, f3.source)
  expect(s3.get('view')).toBe('b')
})

test('往返稳定：set 后重新解码得到同值', async () => {
  const { state, fake } = make('')
  state.set('pairs', [
    [1.5, 2],
    [3, 4],
  ])
  await flush()
  const re = new UrlState<Def>(def, fake.source)
  expect(re.get('pairs')).toEqual([
    [1.5, 2],
    [3, 4],
  ])
})

test('dispose 后不再写入与通知', async () => {
  const { state, fake } = make('')
  state.dispose()
  state.set('level', 2)
  await flush()
  expect(fake.pushes).toHaveLength(0)
})
