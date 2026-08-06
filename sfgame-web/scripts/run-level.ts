import { availableParallelism } from 'node:os'
import { resolve } from 'node:path'
import { better, evalCandidate, FINE_DT, loadLevel, mulberry32, spotGrid, type CandidateMetric, type SourceTuple } from './solve-lib'

const file = process.argv[2]
if (!file) {
  console.error('用法：bun run scripts/run-level.ts <关卡文件> [选项]')
  process.exit(1)
}
const args = process.argv.slice(3)
const opt = (name: string, def = ''): string => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] ?? def : def
}

// 关卡文件转绝对路径：worker 子进程 cwd 与主进程不同，相对路径会找不到文件
const levelFile = resolve(file)
const level = loadLevel(levelFile)
console.log(`关卡 ${level.id}「${level.name}」 ${level.world.w}×${level.world.h} 预算 热${level.budget.hot}/冷${level.budget.cold}`)

function parseSources(raw: string): SourceTuple[] {
  return raw
    .split(',')
    .filter((part) => part.length > 0)
    .map((part) => {
      const [xs, ys, ks] = part.split('-')
      return [Number(xs), Number(ys), ks === 'c' ? 'cold' : 'hot'] as SourceTuple
    })
}

function fmt(m: CandidateMetric): string {
  return m.won
    ? `通关 ${m.time.toFixed(1)}s · 路程 ${m.pathLen.toFixed(1)} · 贴地 ${m.groundTime.toFixed(1)}s`
    : `未通关（进展 ${m.progress}，贴地 ${m.groundTime.toFixed(1)}s）`
}

const simCap = Number(opt('--sim', '20'))
if (args.includes('--sim')) {
  const r = evalCandidate(level, [], { dt: FINE_DT, cap: simCap })
  console.log(r.won ? `无操作：${r.time.toFixed(1)}s 通关` : `无操作：${simCap}s 未通关（站点 ${r.progress / 1000 | 0}/${level.goals.length}）`)
}

if (args.includes('--verify')) {
  const sources = parseSources(opt('--verify'))
  const m = evalCandidate(level, sources, { dt: FINE_DT, cap: 120 })
  console.log(`解有效：${fmt(m)}`)
  if (args.includes('--robust')) {
    const moves = [
      [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
    ]
    let ok = 0
    const failed: string[] = []
    for (let i = 0; i < sources.length; i++) {
      const [x, y, k] = sources[i]
      for (const [dx, dy] of moves) {
        const perturbed = sources.map((s, j) => (j === i ? [x + dx, y + dy, k] as SourceTuple : s))
        const r = evalCandidate(level, perturbed, { dt: FINE_DT, cap: 120 })
        if (r.won) ok++
        else failed.push(`${x + dx}-${y + dy}-${k === 'hot' ? 'h' : 'c'}`)
      }
    }
    const total = sources.length * moves.length
    console.log(`扰动鲁棒性：${ok}/${total}（${((ok / total) * 100).toFixed(0)}%）${failed.length > 0 ? `，失败摆法：${failed.join(' ')}` : ''}`)
  }
}

if (args.includes('--solve')) {
  const n = Number(opt('--solve', '1'))
  const budgetMs = Number(opt('--budget-ms', '45000'))
  const workers = Math.min(
    Number(opt('--workers', String(Math.max(1, availableParallelism() - 1)))),
    availableParallelism(),
  )
  const rng = mulberry32(Number(opt('--seed', String(Date.now() >>> 0))))
  const kinds = new Set(
    opt('--kinds', 'h,c')
      .split(',')
      .filter((k) => k === 'h' || k === 'c')
      .map((k) => (k === 'h' ? 'hot' : 'cold')),
  ) as Set<'hot' | 'cold'>
  const { best, hall } = await geneticSolve(n, budgetMs, workers, rng, kinds)
  if (best && best.m.won) {
    const fine = evalCandidate(level, best.src, { dt: FINE_DT, cap: 120 })
    console.log(`[solve] 最优（${workers} worker 并行）：${best.src.map((s) => `${s[0]}-${s[1]}-${s[2][0]}`).join(',')}`)
    console.log(`[solve] 粗筛 ${fmt(best.m)} → 精验 ${fmt(fine)}`)
    if (hall.length > 1) {
      console.log('[solve] 候选榜（按质量排序，可逐一 --verify --robust 复核）：')
      hall.forEach((h, i) => {
        console.log(`  #${i + 1} ${h.src.map((s) => `${s[0]}-${s[1]}-${s[2][0]}`).join(',')} → ${fmt(h.m)}`)
      })
    }
  } else {
    console.log(`[solve] ${(budgetMs / 1000).toFixed(0)}s 内未找到可通关摆法（当前最佳：${best ? fmt(best.m) : '无'}）`)
  }
}

// 遗传算法：精英保留 + 锦标赛选择 + 均匀交叉 + 邻域变异，worker 并行评估；种子含已登记参考解（至少保住当前解），连续停滞重随机重启
async function geneticSolve(
  n: number,
  budgetMs: number,
  workerCount: number,
  rng: () => number,
  kinds: Set<'hot' | 'cold'>,
): Promise<{
  best: { src: SourceTuple[]; m: CandidateMetric } | null
  hall: Array<{ src: SourceTuple[]; m: CandidateMetric }>
}> {
  const spots = spotGrid(level).filter((s) => kinds.has(s[2]))
  const POP = 32
  const ELITE = 4
  const pool = new WorkerPool(workerCount)
  const seeds: SourceTuple[][] = []
  for (const s of level.json.solutions ?? []) {
    if (s.sources.length !== n || !s.sources.every((p) => kinds.has(p.kind))) continue
    seeds.push(s.sources.map((p) => [p.x, p.y, p.kind]))
  }
  let pop: SourceTuple[][] = seeds.slice(0, POP)
  while (pop.length < POP) pop.push(randomSources(n, spots, rng))

  const hall: Array<{ src: SourceTuple[]; m: CandidateMetric }> = []

  const t0 = performance.now()
  const deadline = t0 + budgetMs
  let best: { src: SourceTuple[]; m: CandidateMetric } | null = null
  let lastPrint = t0
  let gen = 0
  let stale = 0

  while (performance.now() < deadline) {
    const metrics = await pool.evaluate(pop)
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
      console.log(`[solve] 第 ${gen} 代 · ${((now - t0) / 1000).toFixed(0)}s · 最优 ${best ? fmt(best.m) : '—'}`)
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
      const keep = pop.slice(0, ELITE)
      pop = [...keep, ...seeds.slice(0, POP - keep.length)]
      while (pop.length < POP) pop.push(randomSources(n, spots, rng))
      stale = 0
      console.log(`[solve] 第 ${gen} 代 · 停滞重启（重随机）`)
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

function addToHall(
  hall: Array<{ src: SourceTuple[]; m: CandidateMetric }>,
  entry: { src: SourceTuple[]; m: CandidateMetric },
) {
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

const FALLBACK_METRIC: CandidateMetric = { won: false, time: -1, pathLen: 0, groundTime: 0, progress: 0 }

class WorkerPool {
  private procs: Array<{ proc: import('bun').Subprocess; buf: string; idle: boolean; jobId: number }> = []
  private queue: Array<{ src: SourceTuple[]; resolve: (m: CandidateMetric) => void }> = []
  private open = 0
  private closed = false

  constructor(count: number) {
    for (let i = 0; i < count; i++) this.spawn()
  }

  private spawn() {
    const proc = Bun.spawn([process.execPath, `${import.meta.dir}/solve-worker.ts`, levelFile], {
      cwd: import.meta.dir,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const w = { proc, buf: '', idle: true, jobId: 0 }
    this.procs.push(w)
    // worker 意外退出：丢弃其在途任务（按失败计）并补起替身——否则在途 Promise 永不 resolve，evaluate 无声挂死
    void proc.exited.then(() => {
      if (this.closed) return
      const i = this.procs.indexOf(w)
      if (i >= 0) this.procs.splice(i, 1)
      if (w.jobId > 0 && this.pending.has(w.jobId)) {
        this.open--
        this.pending.get(w.jobId)!(FALLBACK_METRIC)
        this.pending.delete(w.jobId)
      }
      this.spawn()
      this.pump()
    }).catch(() => {})
    const decoder = new TextDecoder()
    void (async () => {
      if (proc.stderr) {
        for await (const chunk of proc.stderr) {
          process.stderr.write(new TextDecoder().decode(chunk))
        }
      }
    })()
    void (async () => {
      for await (const chunk of proc.stdout) {
        w.buf += decoder.decode(chunk)
        let nl: number
        while ((nl = w.buf.indexOf('\n')) >= 0) {
          const line = w.buf.slice(0, nl).trim()
          w.buf = w.buf.slice(nl + 1)
          if (!line) continue
          try {
            const msg = JSON.parse(line) as { id: number; m: CandidateMetric }
            this.open--
            if (this.pending.has(msg.id)) {
              this.pending.get(msg.id)!(msg.m)
              this.pending.delete(msg.id)
            }
          } catch {
          }
          w.idle = true
          this.pump()
        }
      }
    })()
    this.pump()
  }

  private pending = new Map<number, (m: CandidateMetric) => void>()
  private nextId = 0

  private pump() {
    for (const w of this.procs) {
      if (!w.idle || this.queue.length === 0) continue
      const job = this.queue.shift()!
      const id = ++this.nextId
      w.idle = false
      w.jobId = id
      this.open++
      this.pending.set(id, job.resolve)
      if (w.proc.stdin && typeof w.proc.stdin !== 'number') {
        w.proc.stdin.write(`${JSON.stringify({ id, src: job.src })}\n`)
        w.proc.stdin.flush()
      }
    }
  }

  evaluate(list: SourceTuple[][]): Promise<CandidateMetric[]> {
    const out = new Array<CandidateMetric>(list.length)
    return new Promise((resolveAll) => {
      let done = 0
      for (let i = 0; i < list.length; i++) {
        this.queue.push({
          src: list[i],
          resolve: (m) => {
            out[i] = m
            if (++done === list.length) resolveAll(out)
          },
        })
      }
      this.pump()
    })
  }

  async close() {
    this.closed = true
    for (const w of this.procs) w.proc.kill()
    this.procs = []
  }
}
