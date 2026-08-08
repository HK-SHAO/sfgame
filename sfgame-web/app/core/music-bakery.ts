// stem 烘焙管理：Worker 后台烘焙（主线程零开销）+ 内存单槽缓存 + 串行队列
// Worker 不可用/超时/出错一律 resolve(null)，调用方回退主线程分片烘焙（永不阻塞音乐启动）

import { type BakedStems } from './music'

export type BakeProgress = (done: number, total: number) => void

interface Job {
  levelId: number
  resolve: (s: BakedStems | null) => void
  onProgress?: BakeProgress
}

// 单槽上限（每关 ~8MB）：预烘产物只在"烘完→起播"间驻留，起播即取走释放
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

// 请求烘焙（缓存命中/同关在途直接复用 Promise）；resolve(null) = Worker 路径失败，须回退
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
  let stems: BakedStems | null = null
  try {
    stems = await runInWorker(job)
  } catch {
    stems = null
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
