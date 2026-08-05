import type { SourcePlacement } from './types'
import { name } from '../../package.json'

/**
 * 玩家进度持久化（localStorage，可注入存储以便无头测试）：
 * 每关记录通关成绩榜（只留合计耗时最优秀的 PROGRESS_TOP_N 条，含当时解法摆放），
 * 关卡解锁 = 第 1 关恒解锁，其余需上一关至少通关一次。
 * 载荷带 schema 版本，解析容错（损坏/未知版本 → 空进度，绝不抛错）。
 * 键前缀统一跟随 package.json 的 name（存储管理页据此识别/摘要，勿改）。
 */
export const PROGRESS_TOP_N = 3
/** localStorage 键：name 前缀 + 载荷版本 */
export const STORAGE_KEY = `${name}.progress.v1`

export interface ScoreEntry {
  /** 实际用时（秒） */
  time: number
  /** 罚时（秒） */
  extra: number
  /** 合计耗时 = time + extra（成绩排序键） */
  total: number
  /** 该次通关的解法摆放（URL src 同构） */
  sources: SourcePlacement[]
  /** 记录时刻（去重/排序兜底） */
  at: number
}

export interface ProgressStorage {
  get(): string | null
  set(raw: string): void
}

interface ProgressJson {
  v: 1
  levels: Record<string, ScoreEntry[]>
}

function parseEntry(raw: unknown): ScoreEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  const time = Number(e.time)
  const extra = Number(e.extra)
  const at = Number(e.at)
  if (!Number.isFinite(time) || !Number.isFinite(extra) || !Number.isFinite(at)) return null
  const sources: SourcePlacement[] = []
  if (Array.isArray(e.sources)) {
    for (const s of e.sources as unknown[]) {
      if (!s || typeof s !== 'object') continue
      const src = s as Record<string, unknown>
      const x = Number(src.x)
      const y = Number(src.y)
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      const kind = src.kind
      if (kind !== 'hot' && kind !== 'cold') continue
      sources.push({ x, y, kind })
    }
  }
  return { time, extra, total: time + extra, sources, at }
}

function parseProgress(raw: string | null): ProgressJson {
  const empty: ProgressJson = { v: 1, levels: {} }
  if (!raw) return empty
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return empty
  }
  if (!data || typeof data !== 'object') return empty
  const d = data as { v?: unknown; levels?: unknown }
  if (d.v !== 1 || !d.levels || typeof d.levels !== 'object') return empty
  const levels: Record<string, ScoreEntry[]> = {}
  for (const [id, list] of Object.entries(d.levels as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue
    const entries: ScoreEntry[] = []
    for (const e of list) {
      const parsed = parseEntry(e)
      if (parsed) entries.push(parsed)
    }
    if (entries.length > 0) levels[id] = entries
  }
  return { v: 1, levels }
}

/** 成绩榜排序：合计耗时升序，其次实际用时，最后记录时刻（并列时旧记录在前）。 */
function sortEntries(entries: ScoreEntry[]): ScoreEntry[] {
  return [...entries].sort((a, b) => a.total - b.total || a.time - b.time || a.at - b.at)
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
        /* 隐私模式/存储禁用：静默降级，进度仅本次会话有效 */
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

  /** 记录一次通关：并入该关成绩榜（只留 TOP_N 条）并持久化。
   * 返回该次成绩的排名（0 = 新纪录；-1 = 未进榜）。 */
  record(levelId: number, entry: Omit<ScoreEntry, 'total' | 'at'> & { at?: number }): number {
    const full: ScoreEntry = { ...entry, total: entry.time + entry.extra, at: entry.at ?? Date.now() }
    const list = sortEntries([...(this.data.levels[String(levelId)] ?? []), full]).slice(0, PROGRESS_TOP_N)
    this.data.levels[String(levelId)] = list
    this.storage.set(JSON.stringify(this.data))
    return list.indexOf(full)
  }

  /** 该关成绩榜（按合计耗时升序，≤ PROGRESS_TOP_N 条；无记录 = 空） */
  best(levelId: number): ScoreEntry[] {
    return this.data.levels[String(levelId)] ?? []
  }

  completed(levelId: number): boolean {
    return this.best(levelId).length > 0
  }

  /** 关卡解锁：第 1 关恒解锁，其余需上一关通关至少一次。 */
  isUnlocked(levelId: number): boolean {
    return levelId === 1 || this.completed(levelId - 1)
  }
}

/** 浏览器单例（无头环境安全：localStorage 访问全部 try/catch 兜底） */
export const progress = new PlayerProgress(createBrowserStorage())
