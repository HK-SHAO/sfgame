// stem 烘焙管理：IndexedDB 持久缓存 → Worker 后台烘焙（主线程零开销）→ 内存单槽缓存 + 串行队列
// 烘焙产物（每关 ~8MB PCM）超 localStorage 配额，存 IndexedDB；二次加载起零烘焙
// Worker 不可用/超时/出错一律 resolve(null)，调用方回退主线程分片烘焙（永不阻塞音乐启动）

import { name } from '../../package.json'
import { type BakedStems } from './music'

export type BakeProgress = (done: number, total: number) => void

interface Job {
  levelId: number
  resolve: (s: BakedStems | null) => void
  onProgress?: BakeProgress
}

// 合成内核/乐谱结构变更时必须 bump，旧缓存自动作废
const STEM_CACHE_V = 1
const IDB_NAME = `${name}.stems`
const IDB_STORE = 'stems'
const IDB_MAX_ENTRIES = 24

interface StemRecord {
  id: number
  v: number
  t: number
  accomp: ArrayBuffer
  theme: ArrayBuffer
}

// 内存单槽上限（每关 ~8MB）：预烘产物只在"烘完→起播"间驻留，起播即取走释放
const cache = new Map<number, BakedStems>()
const inflight = new Map<number, Promise<BakedStems | null>>()
const queue: Job[] = []
let busy = false

// 取走预烘产物（命中即删，PCM 转交 AudioBuffer 后随 GC 释放）
export function takeStems(levelId: number): BakedStems | null {
  const s = cache.get(levelId)
  if (s) cache.delete(levelId)
  return s ?? null
}

// ---- 存储管理页面向：枚举/删除持久缓存（失败静默返回空/无效） ----

export interface StemCacheInfo {
  id: number
  bytes: number
  time: number
}

// 游标遍历取元数据：不 getAll（全量 PCM 会瞬时占用数百 MB）
export async function listStemCache(): Promise<StemCacheInfo[]> {
  const db = await idbOpen()
  if (!db) return []
  try {
    return await new Promise((resolve) => {
      const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).openCursor()
      const out: StemCacheInfo[] = []
      req.onsuccess = () => {
        const c = req.result
        if (c) {
          const r = c.value as StemRecord
          if (r && r.v === STEM_CACHE_V) {
            out.push({ id: r.id, bytes: r.accomp.byteLength + r.theme.byteLength, time: r.t })
          }
          c.continue()
        } else {
          resolve(out.sort((a, b) => a.id - b.id))
        }
      }
      req.onerror = () => resolve([])
    })
  } catch {
    return []
  } finally {
    db.close()
  }
}

// levelId 缺省 = 全清；同步逐内存单槽缓存，防删后僵尸命中
export async function deleteStemCache(levelId?: number): Promise<void> {
  if (levelId === undefined) cache.clear()
  else cache.delete(levelId)
  const db = await idbOpen()
  if (!db) return
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      const store = tx.objectStore(IDB_STORE)
      if (levelId === undefined) store.clear()
      else store.delete(levelId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    })
  } catch {
  } finally {
    db.close()
  }
}

// 请求烘焙（内存缓存/在途 Promise/IDB 持久缓存依次命中）；resolve(null) = 全路径失败，须回退
export function bakeLevelStems(
  levelId: number,
  onProgress?: BakeProgress,
): Promise<BakedStems | null> {
  const hit = cache.get(levelId)
  if (hit) return Promise.resolve(hit)
  const pending = inflight.get(levelId)
  if (pending) return pending
  const p = new Promise<BakedStems | null>((resolve) => {
    queue.push({ levelId, resolve, onProgress })
    void pump()
  })
  inflight.set(levelId, p)
  void p.finally(() => inflight.delete(levelId))
  return p
}

async function pump() {
  if (busy) return
  const job = queue.shift()
  if (!job) return
  busy = true
  // 三级：IDB 持久缓存（二次加载起零烘焙）→ Worker 后台烘（成功后回写 IDB）→ 失败 null 回退
  let stems = await idbLoad(job.levelId)
  if (stems) {
    job.onProgress?.(1, 1)
  } else {
    try {
      stems = await runInWorker(job)
    } catch {
      stems = null
    }
    if (stems) idbSave(job.levelId, stems)
  }
  if (stems) {
    cache.set(job.levelId, stems)
    // 超单槽逐最旧（Map 迭代序 = 插入序）
    while (cache.size > 1) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
  }
  job.resolve(stems)
  busy = false
  void pump()
}

// ---- IndexedDB 持久层（全部失败静默，不得影响烘焙主链路；无 IDB 环境直接跳过） ----

function idbOpen(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    try {
      const req = indexedDB.open(IDB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: 'id' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function idbLoad(levelId: number): Promise<BakedStems | null> {
  const db = await idbOpen()
  if (!db) return null
  try {
    return await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const req = tx.objectStore(IDB_STORE).get(levelId)
      req.onsuccess = () => {
        const rec = req.result as StemRecord | undefined
        if (rec && rec.v === STEM_CACHE_V && rec.accomp && rec.theme) {
          resolve({ accomp: new Float32Array(rec.accomp), theme: new Float32Array(rec.theme) })
        } else {
          resolve(null)
        }
      }
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  } finally {
    db.close()
  }
}

// fire-and-forget：写失败仅失去缓存收益，不报
function idbSave(levelId: number, stems: BakedStems): void {
  void (async () => {
    const db = await idbOpen()
    if (!db) return
    try {
      const rec: StemRecord = {
        id: levelId,
        v: STEM_CACHE_V,
        t: Date.now(),
        // 复制一份：内存侧 Float32Array 可能被后续取用/释放路径牵连
        accomp: stems.accomp.slice().buffer,
        theme: stems.theme.slice().buffer,
      }
      const tx = db.transaction(IDB_STORE, 'readwrite')
      const store = tx.objectStore(IDB_STORE)
      store.put(rec)
      // dev 内联关卡 id 任意：封顶条数，超限逐最旧（每次保存至多超 1 条，单遍扫描即可）
      const countReq = store.count()
      countReq.onsuccess = () => {
        if (countReq.result <= IDB_MAX_ENTRIES) return
        let oldestKey: IDBValidKey | null = null
        let oldestT = Infinity
        const cursorReq = store.openCursor()
        cursorReq.onsuccess = () => {
          const c = cursorReq.result
          if (c) {
            const r = c.value as StemRecord
            if (r.t < oldestT) {
              oldestT = r.t
              oldestKey = c.primaryKey
            }
            c.continue()
          } else if (oldestKey !== null) {
            store.delete(oldestKey)
          }
        }
      }
    } catch {
    } finally {
      db.close()
    }
  })()
}

const WORKER_BUDGET_MS = 12000

function runInWorker(job: Job): Promise<BakedStems | null> {
  return new Promise((resolve) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./music-worker.ts', import.meta.url), { type: 'module' })
    } catch {
      resolve(null)
      return
    }
    const finish = (stems: BakedStems | null) => {
      clearTimeout(guard)
      worker.terminate()
      resolve(stems)
    }
    // 预算护栏：卡死时弃烘回退，不得吊死音乐启动
    const guard = setTimeout(() => finish(null), WORKER_BUDGET_MS)
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as {
        type: string
        done?: number
        total?: number
        accomp?: ArrayBuffer
        theme?: ArrayBuffer
      }
      if (msg.type === 'progress') {
        job.onProgress?.(msg.done ?? 0, msg.total ?? 1)
      } else if (msg.type === 'done' && msg.accomp && msg.theme) {
        finish({ accomp: new Float32Array(msg.accomp), theme: new Float32Array(msg.theme) })
      } else {
        finish(null)
      }
    }
    worker.onerror = () => finish(null)
    worker.postMessage(job.levelId)
  })
}
