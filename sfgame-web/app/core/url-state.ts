// 写读分离：set/clear 只写 URL、不回调订阅者；onChange 仅响应外部 URL 变化；写入经微任务批量 flush
export interface UrlStateCodec<T> {
  encode(value: T): string
  decode(raw: string | null): T
}

export interface UrlStateListCodec<T> {
  encode(value: T): string
  decode(raw: string): T | null
}

export interface UrlStateSource {
  getParams(): URLSearchParams
  pushState(params: URLSearchParams): void
  replaceState(params: URLSearchParams): void
  onChange(cb: () => void): () => void
}

interface UrlStateWriteOptions {
  replace?: boolean
}

export const codecs = {
  int(def: number | null, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): UrlStateCodec<number | null> {
    return {
      encode(value) {
        return value === null ? '' : String(value)
      },
      decode(raw) {
        if (raw === null || raw === '') return def
        const n = Number(raw)
        if (!Number.isInteger(n) || n < min || n > max) return def
        return n
      },
    }
  },
  bool(def: boolean): UrlStateCodec<boolean> {
    return {
      encode(value) {
        return value ? '1' : '0'
      },
      decode(raw) {
        if (raw === null) return def
        if (raw === '1' || raw === 'true' || raw === 'yes') return true
        if (raw === '0' || raw === 'false' || raw === 'no' || raw === '') return false
        return def
      },
    }
  },
  enum<T extends string>(def: T, values: readonly T[]): UrlStateCodec<T> {
    return {
      encode(value) {
        return value
      },
      decode(raw) {
        if (raw === null || raw === '') return def
        return (values as readonly string[]).includes(raw) ? (raw as T) : def
      },
    }
  },
  list<T>(def: T[], item: UrlStateListCodec<T>, sep = ';'): UrlStateCodec<T[]> {
    return {
      encode(value) {
        return value.map(item.encode).join(sep)
      },
      decode(raw) {
        if (raw === null || raw === '') return def
        const out: T[] = []
        for (const part of raw.split(sep)) {
          const v = item.decode(part)
          if (v !== null) out.push(v)
        }
        return out
      },
    }
  },
}

type KeyOf<D> = keyof D & string

export class UrlState<D extends Record<string, UrlStateCodec<unknown>>> {
  private def: D
  private source: UrlStateSource
  private values = new Map<KeyOf<D>, unknown>()
  private dirty = new Set<KeyOf<D>>()
  private removed = new Set<KeyOf<D>>()
  private subs = new Map<KeyOf<D>, Set<(v: unknown) => void>>()
  private pendingFlush = false
  private applying = false
  private disposed = false
  private unsubscribe: () => void
  private replaceMode = false

  constructor(def: D, source?: UrlStateSource) {
    this.def = def
    this.source =
      source ??
      createBrowserSource(typeof window === 'undefined' ? undefined : (window as unknown as UrlStateWindow))
    this.unsubscribe = this.source.onChange(() => this.sync())
    this.sync()
  }

  get<K extends KeyOf<D>>(key: K): ReturnType<D[K]['decode']> {
    return this.values.get(key) as ReturnType<D[K]['decode']>
  }

  // URL 中是否存在该参数（与解码值无关：decode 失败回落 def 后仍能区分"无参数"与"非法值"）
  has(key: KeyOf<D>): boolean {
    return this.source.getParams().has(key)
  }

  set<K extends KeyOf<D>>(key: K, value: ReturnType<D[K]['decode']>, opts?: UrlStateWriteOptions): void {
    const codec = this.def[key]
    const cur = this.values.get(key)
    const encoded = codec.encode(value as never)
    if (cur !== undefined && codec.encode(cur as never) === encoded) return
    this.values.set(key, value)
    this.dirty.add(key)
    this.removed.delete(key)
    this.scheduleWrite(opts)
  }

  clear<K extends KeyOf<D>>(key: K, opts?: UrlStateWriteOptions): void {
    const codec = this.def[key]
    const cur = this.values.get(key)
    const fallback = codec.decode(null)
    // C3 短路的前提是"URL 已无该参数"：值=fallback 也可能只是解码失败回落，URL 里仍残留脏参数
    const encodedSame = cur !== undefined && codec.encode(cur as never) === codec.encode(fallback as never)
    if (encodedSame && !this.source.getParams().has(key)) return
    this.values.set(key, fallback)
    this.removed.add(key)
    this.dirty.delete(key)
    this.scheduleWrite(opts)
  }

  // 批模式：一次 flush 即一次 history 操作（快照级，无法按键拆分），模式由批内最后一次调用的 opts 决定
  private scheduleWrite(opts?: UrlStateWriteOptions) {
    this.replaceMode = opts?.replace ?? false
    this.scheduleFlush()
  }

  onChange<K extends KeyOf<D>>(key: K, cb: (value: ReturnType<D[K]['decode']>) => void): () => void {
    let set = this.subs.get(key)
    if (!set) {
      set = new Set()
      this.subs.set(key, set)
    }
    set.add(cb as (v: unknown) => void)
    return () => {
      set!.delete(cb as (v: unknown) => void)
    }
  }

  sync(): void {
    if (this.applying || this.disposed) return
    const params = this.source.getParams()
    const changes: Array<[KeyOf<D>, unknown]> = []
    for (const key in this.def) {
      const k = key as KeyOf<D>
      const codec = this.def[k]
      const next = codec.decode(params.get(key))
      const cur = this.values.get(k)
      if (cur === undefined || codec.encode(next as never) !== codec.encode(cur as never)) {
        changes.push([k, next])
      }
    }
    for (const [key, next] of changes) {
      this.values.set(key, next)
    }
    for (const [key, next] of changes) {
      this.notify(key, next)
    }
  }

  dispose(): void {
    this.disposed = true
    this.unsubscribe()
    this.subs.clear()
    this.dirty.clear()
    this.removed.clear()
  }

  private notify(key: KeyOf<D>, value: unknown): void {
    const set = this.subs.get(key)
    if (!set) return
    for (const cb of set) cb(value)
  }

  private scheduleFlush(): void {
    if (this.pendingFlush || this.disposed) return
    this.pendingFlush = true
    queueMicrotask(() => this.flush())
  }

  private flush(): void {
    this.pendingFlush = false
    const replace = this.replaceMode
    this.replaceMode = false
    if (this.disposed || (this.dirty.size === 0 && this.removed.size === 0)) return
    const params = this.source.getParams()
    for (const key of this.dirty) {
      params.set(key, this.def[key].encode(this.values.get(key) as never))
    }
    for (const key of this.removed) params.delete(key)
    this.dirty.clear()
    this.removed.clear()
    // 我们自己的写入不应再次触发 sync（防御异常环境回环）
    this.applying = true
    try {
      if (replace) this.source.replaceState(params)
      else this.source.pushState(params)
    } finally {
      this.applying = false
    }
  }
}

// 浏览器面（可注入，与 getParams 等同一契约）：sf 标记与 bfcache 兜底在此落点，
// 注入 stub 后 popstate/pageshow 行为与 history.state 标记可无头测试
export interface UrlStateWindow {
  location: { pathname: string; search: string; hash: string }
  history: {
    state: unknown
    pushState(state: unknown, _title: string, url: string): void
    replaceState(state: unknown, _title: string, url: string): void
  }
  addEventListener(type: string, cb: () => void): void
  removeEventListener(type: string, cb: () => void): void
}

export function createBrowserSource(win: UrlStateWindow | undefined): UrlStateSource {
  // node/无头环境无 window：空状态 + 写无操作 + 无监听（与旧 typeof 守卫同语义）
  if (!win) {
    return {
      getParams: () => new URLSearchParams(),
      pushState() {},
      replaceState() {},
      onChange() {
        return () => {}
      },
    }
  }
  const buildUrl = (params: URLSearchParams) => {
    const q = params.toString()
    return (q ? `${win.location.pathname}?${q}` : win.location.pathname) + win.location.hash
  }
  return {
    getParams() {
      try {
        return new URLSearchParams(win.location.search)
      } catch {
        return new URLSearchParams()
      }
    },
    pushState(params) {
      try {
        // sf 标记 = 应用内导航条目：返回按钮据此区分"可回退上一应用页"与"直达/外部进入（回首页）"
        win.history.pushState({ sf: true }, '', buildUrl(params))
      } catch {
      }
    },
    replaceState(params) {
      try {
        // 保留当前条目标记：应用条目上 replace 不丢标记，文档条目（无标记）不被污染
        win.history.replaceState(
          win.history.state && (win.history.state as { sf?: boolean }).sf ? { sf: true } : null,
          '',
          buildUrl(params),
        )
      } catch {
      }
    },
    onChange(cb) {
      const fire = () => cb()
      win.addEventListener('popstate', fire)
      // pageshow 兜 bfcache 恢复：某些 iOS 环境后退时 popstate 不可靠
      win.addEventListener('pageshow', fire)
      return () => {
        win.removeEventListener('popstate', fire)
        win.removeEventListener('pageshow', fire)
      }
    },
  }
}
