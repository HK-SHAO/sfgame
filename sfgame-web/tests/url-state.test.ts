import { expect, test } from 'vitest'
import {
  UrlState,
  codecs,
  createBrowserSource,
  type UrlStateListCodec,
  type UrlStateSource,
  type UrlStateWindow,
} from '../app/core/url-state.ts'

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

test('批模式：一次 flush 即一次 history 操作，模式由批内最后一次调用的 opts 决定', async () => {
  const { state, fake } = make('')
  state.set('level', 1, { replace: true })
  state.set('count', 3)
  await flush()
  expect(fake.replaces).toHaveLength(0)
  expect(fake.pushes).toEqual(['level=1&count=3'])

  const rep = make('')
  rep.state.set('level', 1)
  rep.state.set('count', 3, { replace: true })
  await flush()
  expect(rep.fake.pushes).toHaveLength(0)
  expect(rep.fake.replaces).toEqual(['level=1&count=3'])
})

test('clear 移除 URL 中解码失败的脏参数；URL 干净时仍早退', async () => {
  const dirty = make('level=abc')
  expect(dirty.state.get('level')).toBeNull()
  dirty.state.clear('level')
  await flush()
  expect(dirty.fake.pushes).toEqual([''])

  const clean = make('')
  clean.state.clear('level')
  await flush()
  expect(clean.fake.pushes).toHaveLength(0)
  expect(clean.fake.replaces).toHaveLength(0)
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

test('has：区分"无参数"与"解码失败回落默认"', () => {
  const { state } = make('level=abc')
  expect(state.has('level')).toBe(true) // URL 有参数（值非法回落 null）仍算"有"
  expect(state.has('count')).toBe(false)
})

test('dispose：退订外部变化、拒绝后续写入', async () => {
  const { state, fake } = make('level=1')
  let n = 0
  state.onChange('level', () => n++)
  state.dispose()
  fake.applyUrl('level=2')
  expect(n).toBe(0)
  expect(state.get('level')).toBe(1) // 不再同步外部变化
  state.set('count', 3)
  await flush()
  expect(fake.pushes).toHaveLength(0) // 写入被拒
})

test('浏览器源：pushState 带 sf 标记、replaceState 保留/不污染标记、popstate+pageshow 挂载与退订', () => {
  const history: Array<{ state: unknown; url: string }> = []
  const listeners = new Map<string, () => void>()
  const win = {
    location: { pathname: '/play', search: '', hash: '' },
    history: {
      state: null as unknown,
      pushState(state: unknown, _t: string, url: string) {
        history.push({ state, url })
      },
      replaceState(state: unknown, _t: string, url: string) {
        history.push({ state, url })
      },
    },
    addEventListener(type: string, cb: () => void) {
      listeners.set(type, cb)
    },
    removeEventListener(type: string) {
      listeners.delete(type)
    },
  } as unknown as UrlStateWindow
  const src = createBrowserSource(win)
  src.pushState(new URLSearchParams('level=2'))
  expect(history.at(-1)).toEqual({ state: { sf: true }, url: '/play?level=2' })
  // 应用条目上 replace 保留标记；文档条目（无标记）不被污染
  win.history.state = { sf: true }
  src.replaceState(new URLSearchParams('level=3'))
  expect(history.at(-1)).toEqual({ state: { sf: true }, url: '/play?level=3' })
  win.history.state = null
  src.replaceState(new URLSearchParams('level=4'))
  expect(history.at(-1)).toEqual({ state: null, url: '/play?level=4' })
  // popstate/pageshow 均在 onChange 注册时挂载（bfcache 兜底契约），退订全清
  const off = src.onChange(() => {})
  expect(listeners.has('popstate')).toBe(true)
  expect(listeners.has('pageshow')).toBe(true)
  off()
  expect(listeners.size).toBe(0)
})
