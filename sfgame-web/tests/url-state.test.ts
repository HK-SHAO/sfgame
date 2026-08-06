import { expect, test } from 'vitest'
import {
  UrlState,
  codecs,
  type UrlStateListCodec,
  type UrlStateSource,
} from '../src/core/url-state'

function fakeSource(initial = '') {
  let params = new URLSearchParams(initial)
  const pushes: string[] = []
  const replaces: string[] = []
  let cb: (() => void) | null = null
  return {
    source: {
      getParams: () => new URLSearchParams(params),
      pushState: (p: URLSearchParams) => {
        params = new URLSearchParams(p)
        pushes.push(params.toString())
      },
      replaceState: (p: URLSearchParams) => {
        params = new URLSearchParams(p)
        replaces.push(params.toString())
      },
      onChange: (f: () => void) => {
        cb = f
        return () => {
          cb = null
        }
      },
    } as UrlStateSource,
    pushes,
    replaces,
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

test('初始解码：合法值生效，非法/缺失回落默认', () => {
  const { state } = make('level=2&flag=1&pairs=1:2;3:4')
  expect(state.get('level')).toBe(2)
  expect(state.get('count')).toBe(5)
  expect(state.get('flag')).toBe(true)
  expect(state.get('pairs')).toEqual([
    [1, 2],
    [3, 4],
  ])
  const bad = make('level=abc&count=99&flag=maybe&pairs=1:2;bad')
  expect(bad.state.get('level')).toBeNull()
  expect(bad.state.get('count')).toBe(5)
  expect(bad.state.get('flag')).toBe(false)
  expect(bad.state.get('pairs')).toEqual([[1, 2]])
})

test('set 微任务批量写入、等值跳过、replace 不新增历史', async () => {
  const { state, fake } = make('')
  state.set('level', 1)
  state.set('count', 3)
  state.set('flag', true)
  expect(fake.pushes).toHaveLength(0)
  await flush()
  expect(fake.pushes).toEqual(['level=1&count=3&flag=1'])

  const eq = make('level=2')
  let notified = 0
  eq.state.onChange('level', () => notified++)
  eq.state.set('level', 2)
  await flush()
  expect(eq.fake.pushes).toHaveLength(0)
  expect(notified).toBe(0)

  const rep = make('')
  rep.state.set('flag', true, { replace: true })
  await flush()
  expect(rep.fake.pushes).toHaveLength(0)
  expect(rep.fake.replaces).toEqual(['flag=1'])
})

test('写读分离：set 不通知订阅者，外部 URL 变化才同步并通知；退订生效', async () => {
  const { state, fake } = make('level=1')
  let writes = 0
  state.onChange('count', () => writes++)
  state.set('count', 3)
  await flush()
  expect(writes).toBe(0)

  const seen: Array<number | null> = []
  state.onChange('level', (v) => seen.push(v))
  fake.applyUrl('level=2')
  expect(state.get('level')).toBe(2)
  expect(seen).toEqual([2])

  let n = 0
  const off = state.onChange('count', () => n++)
  fake.applyUrl('count=4')
  off()
  fake.applyUrl('count=5')
  expect(n).toBe(1)
  expect(state.get('count')).toBe(5)
})
