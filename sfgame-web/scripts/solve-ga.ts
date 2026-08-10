// 遗传算法搜索引擎（run-level --solve）：精英保留 + 锦标赛选择 + 均匀交叉 + 邻域变异，worker 并行评估；连续停滞重随机重启。
// 纯搜索无 I/O：进度经 onStatus 回调上报，打印归 CLI
import { better, spotGrid, WorkerPool, type CandidateMetric, type SourceTuple } from './solve-lib.ts'
import type { LevelDef } from '../app/game/types.ts'

const POP = 32
const ELITE = 4

export type GaEntry = { src: SourceTuple[]; m: CandidateMetric }

export interface GaOptions {
  level: LevelDef
  levelFile: string
  n: number
  budgetMs: number
  workerCount: number
  rng: () => number
  kinds: Set<'hot' | 'cold'>
  solveCap: number
  // 周期进度（每 5s 一次）与停滞重启上报：restart=true 即本次为重启事件
  onStatus?: (gen: number, elapsedMs: number, best: GaEntry | null, restart: boolean) => void
}

export async function geneticSolve(opts: GaOptions): Promise<{ best: GaEntry | null; hall: GaEntry[] }> {
  const { level, levelFile, n, budgetMs, workerCount, rng, kinds, solveCap, onStatus } = opts
  const spots = spotGrid(level).filter((s) => kinds.has(s[2]))
  const pool = new WorkerPool(levelFile, workerCount)
  let pop: SourceTuple[][] = []
  while (pop.length < POP) pop.push(randomSources(n, spots, rng))

  const hall: GaEntry[] = []
  const t0 = performance.now()
  const deadline = t0 + budgetMs
  let best: GaEntry | null = null
  let lastPrint = t0
  let gen = 0
  let stale = 0

  while (performance.now() < deadline) {
    const metrics = await pool.evaluate(pop, solveCap)
    for (let i = 0; i < POP; i++) {
      const entry = { src: pop[i], m: metrics[i] }
      if (!best || better(metrics[i], best.m)) {
        best = entry
        stale = 0
      }
      if (metrics[i].won) addToHall(hall, entry)
    }
    const now = performance.now()
    if (now - lastPrint > 5000) {
      lastPrint = now
      onStatus?.(gen, now - t0, best, false)
    }
    const order = pop.map((_, i) => i).sort((a, b) => (better(metrics[b], metrics[a]) ? 1 : better(metrics[a], metrics[b]) ? -1 : 0))
    const next: SourceTuple[][] = []
    for (let i = 0; i < ELITE; i++) next.push(pop[order[i]])
    while (next.length < POP) {
      next.push(child(pop[order[tournament(rng, order)]], pop[order[tournament(rng, order)]], spots, rng))
    }
    pop = next
    gen++
    if (++stale > 8) {
      pop = pop.slice(0, ELITE)
      while (pop.length < POP) pop.push(randomSources(n, spots, rng))
      stale = 0
      onStatus?.(gen, performance.now() - t0, best, true)
    }
  }
  await pool.close()
  return { best, hall }
}

function randomSources(n: number, spots: SourceTuple[], rng: () => number): SourceTuple[] {
  const c: SourceTuple[] = []
  for (let j = 0; j < n; j++) c.push(spots[Math.floor(rng() * spots.length)])
  return c
}

function srcKey(src: SourceTuple[]): string {
  return src.map((s) => `${s[0]}-${s[1]}-${s[2][0]}`).join(',')
}

function addToHall(hall: GaEntry[], entry: GaEntry) {
  const key = srcKey(entry.src)
  if (hall.some((h) => srcKey(h.src) === key)) return
  hall.push(entry)
  hall.sort((a, b) => (better(b.m, a.m) ? 1 : better(a.m, b.m) ? -1 : 0))
  if (hall.length > 5) hall.length = 5
}

function tournament(rng: () => number, order: number[]): number {
  const a = order[Math.floor(rng() * order.length)]
  const b = order[Math.floor(rng() * order.length)]
  return a <= b ? a : b
}

function child(
  a: SourceTuple[],
  b: SourceTuple[],
  spots: SourceTuple[],
  rng: () => number,
): SourceTuple[] {
  const c: SourceTuple[] = []
  for (let j = 0; j < a.length; j++) {
    let s = rng() < 0.5 ? a[j] : b[j]
    if (rng() < 0.3) {
      if (rng() < 0.5) {
        let idx = spots.findIndex((p) => p[0] === s[0] && p[1] === s[1] && p[2] === s[2])
        if (idx < 0) idx = Math.floor(rng() * spots.length)
        idx = Math.min(spots.length - 1, Math.max(0, idx + Math.floor(rng() * 7) - 3))
        s = spots[idx]
      } else {
        s = spots[Math.floor(rng() * spots.length)]
      }
    }
    c.push(s)
  }
  return c
}
