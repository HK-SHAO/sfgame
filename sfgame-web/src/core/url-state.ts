/**
 * 通用 URL 状态模块：声明式 schema ↔ URL 查询参数双向绑定。
 * 写读分离：set/clear 不回调订阅者（杜绝"写入→回读→再写入"反馈环），
 * onChange 仅响应外部 URL 变化；解码永不抛错，等值 set 跳过（防历史污染）。
 * 无头可测：URL 源可注入。
 */
export interface UrlStateCodec<T> {
  /** 值 → URL 字符串（null 编为空串，表示"该键无值"） */
  encode(value: T): string
  /** URL 字符串（缺失为 null）→ 值；非法输入必须回落默认值，不得抛错 */
  decode(raw: string | null): T
}

/** list 的元素编解码器：decode 返回 null 表示该元素非法，整体丢弃 */
export interface UrlStateListCodec<T> {
  encode(value: T): string
  decode(raw: string): T | null
}

/** URL 状态源（浏览器适配器实现于本文件；测试可注入内存假源） */
export interface UrlStateSource {
  getParams(): URLSearchParams
  /** pushState 语义：新增历史条目，可后退撤销 */
  pushState(params: URLSearchParams): void
  /** 订阅外部 URL 变化（popstate + pageshow/bfcache 恢复）；返回退订函数 */
  onChange(cb: () => void): () => void
}

export const codecs = {
  /** 整数；def 可为 null（表示无值） */
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
  /** 布尔：'1'/'true'/'yes' 为真，'0'/'false'/'no'/'' 为假 */
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
  /** 枚举字符串：合法值生效，未知/缺失回落默认 */
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
  /** 分隔列表；非法元素逐个丢弃，缺失/空 → def */
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

/** 状态中心：持有一份已解码缓存；set/clear 更新缓存并批量写 URL；onChange 感知外部 URL 变化。 */
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

  constructor(def: D, source?: UrlStateSource) {
    this.def = def
    this.source = source ?? createBrowserSource()
    this.unsubscribe = this.source.onChange(() => this.sync())
    this.sync()
  }

  get<K extends KeyOf<D>>(key: K): ReturnType<D[K]['decode']> {
    return this.values.get(key) as ReturnType<D[K]['decode']>
  }

  /** 更新值：等价于当前值则跳过（防历史污染）；写 URL（微任务批量）。
   * 不回调订阅者——onChange 仅响应外部 URL 变化，写方自知。 */
  set<K extends KeyOf<D>>(key: K, value: ReturnType<D[K]['decode']>): void {
    const codec = this.def[key]
    const cur = this.values.get(key)
    const encoded = codec.encode(value as never)
    if (cur !== undefined && codec.encode(cur as never) === encoded) return
    this.values.set(key, value)
    this.dirty.add(key)
    this.removed.delete(key)
    this.scheduleFlush()
  }

  /** 从 URL 移除该键，值回落为默认（def 的 decode(null)）。不回调订阅者。 */
  clear<K extends KeyOf<D>>(key: K): void {
    const codec = this.def[key]
    const cur = this.values.get(key)
    const fallback = codec.decode(null)
    if (cur !== undefined && codec.encode(cur as never) === codec.encode(fallback as never)) return
    this.values.set(key, fallback)
    this.removed.add(key)
    this.dirty.delete(key)
    this.scheduleFlush()
  }

  /** 订阅某键变化（仅外部 URL 变化触发）；返回退订函数。 */
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

  /** 从 URL 重新解码全部键（popstate 触发；与当前等价则无通知）。
   * 三阶段：解码 → 全部应用 → 统一通知——订阅者回调里读取任何键都是一致的最新状态。 */
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
      this.source.pushState(params)
    } finally {
      this.applying = false
    }
  }
}

/** 浏览器适配器：location.search ↔ history.pushState + popstate/pageshow。 */
function createBrowserSource(): UrlStateSource {
  return {
    getParams() {
      try {
        return new URLSearchParams(window.location.search)
      } catch {
        return new URLSearchParams()
      }
    },
    pushState(params) {
      try {
        const q = params.toString()
        const url = (q ? `${window.location.pathname}?${q}` : window.location.pathname) + window.location.hash
        window.history.pushState(null, '', url)
      } catch {
        /* 沙箱/受限环境：静默降级，状态仍在内存中生效 */
      }
    },
    onChange(cb) {
      // 无头环境（node 测试 import schema 单例）：静默不监听
      if (typeof window === 'undefined') return () => {}
      const fire = () => cb()
      window.addEventListener('popstate', fire)
      // bfcache 恢复（某些 iOS 环境后退时 popstate 不可靠）：页面恢复即重新对齐。
      // 幂等：URL 未变则 sync 无变化、零开销。
      window.addEventListener('pageshow', fire)
      return () => {
        window.removeEventListener('popstate', fire)
        window.removeEventListener('pageshow', fire)
      }
    },
  }
}
