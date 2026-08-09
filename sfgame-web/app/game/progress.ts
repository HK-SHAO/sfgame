import { name } from '../../package.json'

// localStorage 进度载荷带版本（.progress.v2）：解析容错，损坏/未知版本 → 空进度绝不抛错；
// 键前缀跟随 package.json name（存储管理页据此识别，勿改）。
// 键 = 关卡内容 hash（levels.ts levelHash）：关卡改版即失效，内联 DIY 关卡互不串号。
// 只记最佳过关耗时（不记解摆法），新纪录覆盖旧值
export const STORAGE_KEY = `${name}.progress.v2`

export interface ScoreEntry {
  time: number
  extra: number
  total: number
  at: number
}

export interface ProgressStorage {
  get(): string | null
  set(raw: string): void
}

interface ProgressJson {
  v: 2
  levels: Record<string, ScoreEntry>
}

function parseEntry(raw: unknown): ScoreEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  const time = Number(e.time)
  const extra = Number(e.extra)
  const at = Number(e.at)
  if (!Number.isFinite(time) || !Number.isFinite(extra) || !Number.isFinite(at)) return null
  return { time, extra, total: time + extra, at }
}

function parseProgress(raw: string | null): ProgressJson {
  const empty: ProgressJson = { v: 2, levels: {} }
  if (!raw) return empty
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return empty
  }
  if (!data || typeof data !== 'object') return empty
  const d = data as { v?: unknown; levels?: unknown }
  if (d.v !== 2 || !d.levels || typeof d.levels !== 'object') return empty
  const levels: Record<string, ScoreEntry> = {}
  for (const [id, rawEntry] of Object.entries(d.levels as Record<string, unknown>)) {
    // 兼容旧版数组载荷（v2 曾存 top3 列表）：取最优一条，多余字段（sources 等）忽略
    const list = Array.isArray(rawEntry) ? rawEntry : [rawEntry]
    let best: ScoreEntry | null = null
    for (const e of list) {
      const parsed = parseEntry(e)
      if (parsed && (!best || parsed.total < best.total)) best = parsed
    }
    if (best) levels[id] = best
  }
  return { v: 2, levels }
}

export function createBrowserStorage(): ProgressStorage {
  return {
    get() {
      try {
        return typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
      } catch {
        return null
      }
    },
    set(raw) {
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, raw)
      } catch {
        // 隐私模式/存储禁用：静默降级，进度仅本次会话有效
      }
    },
  }
}

export class PlayerProgress {
  private storage: ProgressStorage
  private data: ProgressJson

  constructor(storage: ProgressStorage) {
    this.storage = storage
    this.data = parseProgress(storage.get())
  }

  // 新纪录返回 0（rank 语义，win 面板"新纪录"判定），否则 -1
  record(levelHash: string, entry: Omit<ScoreEntry, 'total' | 'at'> & { at?: number }): number {
    const full: ScoreEntry = { ...entry, total: entry.time + entry.extra, at: entry.at ?? Date.now() }
    const prev = this.data.levels[levelHash]
    if (prev && prev.total <= full.total) return -1
    this.data.levels[levelHash] = full
    this.storage.set(JSON.stringify(this.data))
    return 0
  }

  best(levelHash: string): ScoreEntry | undefined {
    return this.data.levels[levelHash]
  }

  completed(levelHash: string): boolean {
    return this.data.levels[levelHash] !== undefined
  }
}

export const progress = new PlayerProgress(createBrowserStorage())
