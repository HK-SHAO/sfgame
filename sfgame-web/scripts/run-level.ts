import { availableParallelism } from 'node:os'
import { resolve } from 'node:path'
import { KNOWN_SOLUTIONS } from './known-solutions'
import {
  better,
  evalCandidate,
  FINE_DT,
  initBackend,
  loadLevel,
  mulberry32,
  spotGrid,
  WorkerPool,
  type CandidateMetric,
  type SourceTuple,
} from './solve-lib'

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

await initBackend()

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

// 已知解回归验证：scripts/known-solutions.ts 序列化的解必须仍通关（物理/关卡改动后跑一遍）
if (args.includes('--verify-known')) {
  const sources = KNOWN_SOLUTIONS[level.id]
  if (sources === undefined) {
    console.log(`关卡 ${level.id} 未登记已知解`)
  } else {
    const m = evalCandidate(level, sources, { dt: FINE_DT, cap: 120 })
    console.log(`已知解（${sources.length === 0 ? '无源' : fmtSrcUrl(sources)}）：${fmt(m)}`)
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

// —— 解精炼：以玩家解为种子的坐标下降局部搜索 ——
// 目标字典序：通关 → 总路程最短 → 总耗时（含罚时 4s/源）最短 → 耗时 → 贴地。
// 邻域 = 单源单轴 ±step（粗到细）+ 删一源；memo 缓存去重评、worker 并行、改进即打印
const SOURCE_PENALTY_S = 4
const REFINE_STEPS = [2, 1, 0.5, 0.2, 0.1]

interface Refined {
  src: SourceTuple[]
  m: CandidateMetric
}

function refineBetter(a: Refined, b: Refined): boolean {
  if (a.m.won !== b.m.won) return a.m.won
  if (!a.m.won) return a.m.progress > b.m.progress
  if (a.m.pathLen !== b.m.pathLen) return a.m.pathLen < b.m.pathLen
  const ta = a.m.time + SOURCE_PENALTY_S * a.src.length
  const tb = b.m.time + SOURCE_PENALTY_S * b.src.length
  if (ta !== tb) return ta < tb
  if (a.m.time !== b.m.time) return a.m.time < b.m.time
  return a.m.groundTime < b.m.groundTime
}

// 缓存键：排序规范化（同一多重集同键）+ 1 位小数（URL 可放置形态）
function srcKeySorted(src: SourceTuple[]): string {
  return src
    .map((s) => `${+s[0].toFixed(1)},${+s[1].toFixed(1)},${s[2]}`)
    .sort()
    .join('_')
}

function fmtSrcUrl(src: SourceTuple[]): string {
  return src.map((s) => `${+s[0].toFixed(1)}-${+s[1].toFixed(1)}-${s[2] === 'hot' ? 'h' : 'c'}`).join('_')
}

function fmtTotal(src: SourceTuple[], m: CandidateMetric): string {
  const p = SOURCE_PENALTY_S * src.length
  return `${fmt(m)} · 总耗时 ${(m.time + p).toFixed(1)}s（含罚时 +${p}s）`
}

function refineNeighbors(src: SourceTuple[], step: number): SourceTuple[][] {
  const out: SourceTuple[][] = []
  for (let i = 0; i < src.length; i++) {
    const [x, y, k] = src[i]
    for (const [dx, dy] of [
      [step, 0],
      [-step, 0],
      [0, step],
      [0, -step],
    ]) {
      const nx = +(x + dx).toFixed(1)
      const ny = +(y + dy).toFixed(1)
      // 先裁剪到 spawn 同界，减少注定放置失败的浪费评估
      if (nx < -20 || nx > level.world.w + 20 || ny < -20 || ny > level.world.h + 20) continue
      out.push(src.map((s, j) => (j === i ? ([nx, ny, k] as SourceTuple) : s)))
    }
    if (src.length > 1) out.push(src.filter((_, j) => j !== i))
  }
  return out
}

async function refineSolution(start: SourceTuple[], cap: number, budgetMs: number, workerCount: number): Promise<void> {
  const t0 = performance.now()
  const deadline = t0 + budgetMs
  const pool = new WorkerPool(levelFile, workerCount)
  const cache = new Map<string, CandidateMetric>()
  let evalCount = 0
  // 缓存门控：只对未见过的摆法发起并行评估，其余直取缓存
  const evalMany = async (list: SourceTuple[][]): Promise<CandidateMetric[]> => {
    const fresh = list.filter((s) => !cache.has(srcKeySorted(s)))
    if (fresh.length > 0) {
      const ms = await pool.evaluate(fresh, cap)
      fresh.forEach((s, i) => cache.set(srcKeySorted(s), ms[i]))
      evalCount += fresh.length
    }
    return list.map((s) => cache.get(srcKeySorted(s))!)
  }

  if (start.length === 0) {
    console.log('[refine] 基线无源：无坐标可动、无源可删，无优化空间')
    await pool.close()
    return
  }
  const [m0] = await evalMany([start])
  let cur: Refined = { src: start, m: m0 }
  const base = cur
  console.log(`[refine] 基线：${fmtTotal(cur.src, cur.m)}`)
  if (!cur.m.won) {
    console.log(`[refine] 基线在 cap=${cap}s 内未通关（玩家实局可能依赖飞行中放置的时序，无头评估源在 t=0 全放）——按进展序继续搜索，直到爬进通关`)
  }

  for (const step of REFINE_STEPS) {
    let moved = true
    while (moved && performance.now() < deadline) {
      moved = false
      const cands = refineNeighbors(cur.src, step)
      const ms = await evalMany(cands)
      let best = cur
      for (let i = 0; i < cands.length; i++) {
        const e: Refined = { src: cands[i], m: ms[i] }
        if (refineBetter(e, best)) best = e
      }
      if (best !== cur) {
        cur = best
        moved = true
        console.log(`[refine] 步长 ${step} 改进：${fmtSrcUrl(cur.src)} → ${fmtTotal(cur.src, cur.m)}`)
      }
    }
  }
  await pool.close()

  console.log(`[refine] 完成：${evalCount} 次评估 · ${((performance.now() - t0) / 1000).toFixed(0)}s · 步长 ${REFINE_STEPS.join('/')}`)
  if (cur === base) {
    console.log('[refine] 未找到优于基线的摆法（邻域内已局部最优）')
  } else {
    console.log(`[refine] 路程 ${base.m.pathLen.toFixed(1)} → ${cur.m.pathLen.toFixed(1)}，总耗时 ${(base.m.time + SOURCE_PENALTY_S * base.src.length).toFixed(1)}s → ${(cur.m.time + SOURCE_PENALTY_S * cur.src.length).toFixed(1)}s`)
  }
  console.log(`[refine] 最优摆法（URL s= 形态）：${fmtSrcUrl(cur.src)}`)
  console.log(`[refine] 最优摆法（--verify 逗号形态）：${cur.src.map((s) => `${+s[0].toFixed(1)}-${+s[1].toFixed(1)}-${s[2][0]}`).join(',')}`)
}

// 入口放在定义之后：顶层 const（SOURCE_PENALTY_S 等）不提升，提前触发会 TDZ
if (args.includes('--refine')) {
  const raw = opt('--refine')
  // 无参（或后跟其他选项）时以 known-solutions.ts 登记解为种子，继续优化
  const start = raw && !raw.startsWith('--') ? parseSources(raw) : (KNOWN_SOLUTIONS[level.id] ?? [])
  const cap = Number(opt('--refine-cap', '90'))
  const budgetMs = Number(opt('--refine-ms', '180000'))
  const workers = Math.min(
    Number(opt('--workers', String(Math.max(1, availableParallelism() - 1)))),
    availableParallelism(),
  )
  await refineSolution(start, cap, budgetMs, workers)
}

// 遗传算法：精英保留 + 锦标赛选择 + 均匀交叉 + 邻域变异，worker 并行评估；连续停滞重随机重启
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
  const pool = new WorkerPool(levelFile, workerCount)
  let pop: SourceTuple[][] = []
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
      pop = pop.slice(0, ELITE)
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
