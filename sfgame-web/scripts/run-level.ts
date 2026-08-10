// 关卡工具 CLI：分发 --sim/--verify/--verify-known/--solve/--refine 五个命令。
// 打印与参数解析全在 CLI 层；搜索算法本体在 solve-ga（遗传）与 solve-refine（坐标下降），评估原语/worker 池在 solve-lib
import { availableParallelism } from 'node:os'
import { resolve } from 'node:path'
import { KNOWN_SOLUTIONS, solutionUrl } from './known-solutions'
import { geneticSolve } from './solve-ga'
import { REFINE_STEPS, refineSolution } from './solve-refine'
import {
  evalCandidate,
  FINE_DT,
  initBackend,
  loadLevel,
  mulberry32,
  totalTime,
  verifyRobustness,
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

// —— 通用工具：解析/打印（CLI 专属）——
function parseSources(raw: string): SourceTuple[] {
  return raw
    .split(',')
    .filter((part) => part.length > 0)
    .map((part) => {
      const [xs, ys, ks] = part.split('-')
      return [Number(xs), Number(ys), ks === 'c' ? 'cold' : 'hot'] as SourceTuple
    })
}

function srcComma(src: SourceTuple[]): string {
  return src.map((s) => `${+s[0].toFixed(1)}-${+s[1].toFixed(1)}-${s[2][0]}`).join(',')
}

function fmt(m: CandidateMetric): string {
  return m.won
    ? `通关 ${m.time.toFixed(1)}s · 贴地 ${m.groundTime.toFixed(1)}s · 总耗时 ${totalTime(m).toFixed(1)}s`
    : `未通关（进展 ${m.progress}，贴地 ${m.groundTime.toFixed(1)}s）`
}

function fmtTotal(src: SourceTuple[], m: CandidateMetric): string {
  return `${fmt(m)} · 罚时 ${(totalTime(m) - m.time).toFixed(1)}s（源 ${src.length} 个 + 贴地 ${m.groundTime.toFixed(1)}s）`
}

function workerCount(): number {
  return Math.min(
    Number(opt('--workers', String(Math.max(1, availableParallelism() - 1)))),
    availableParallelism(),
  )
}

// —— 命令：一选项一入口 ——
function cmdSim() {
  const simCap = Number(opt('--sim', '20'))
  const r = evalCandidate(level, [], { dt: FINE_DT, cap: simCap })
  console.log(r.won ? `无操作：${r.time.toFixed(1)}s 通关` : `无操作：${simCap}s 未通关（站点 ${r.progress / 1000 | 0}/${level.goals.length}）`)
}

function cmdVerify() {
  const sources = parseSources(opt('--verify'))
  const m = evalCandidate(level, sources, { dt: FINE_DT, cap: 120 })
  console.log(`解有效：${fmt(m)}`)
  if (args.includes('--robust')) {
    const r = verifyRobustness(level, sources)
    console.log(`扰动鲁棒性：${r.ok}/${r.total}（${((r.ok / r.total) * 100).toFixed(0)}%）${r.failed.length > 0 ? `，失败摆法：${r.failed.join(' ')}` : ''}`)
  }
}

// 已知解回归验证：scripts/known-solutions.ts 序列化的解必须仍通关（物理/关卡改动后跑一遍）
function cmdVerifyKnown() {
  const known = KNOWN_SOLUTIONS[level.id]
  if (known === undefined) {
    console.log(`关卡 ${level.id} 未登记已知解`)
  } else {
    const m = evalCandidate(level, known.src, { dt: FINE_DT, cap: 120 })
    console.log(`已知解（${known.src.length === 0 ? '无源' : solutionUrl(known.src)}）：${fmt(m)}`)
  }
}

async function cmdSolve() {
  const n = Number(opt('--solve', '1'))
  const budgetMs = Number(opt('--budget-ms', '45000'))
  // 粗筛 cap：耗时优先级下参考解可超 35s，快筛默认 90s 留足余量
  const solveCap = Number(opt('--solve-cap', '90'))
  const workers = workerCount()
  const rng = mulberry32(Number(opt('--seed', String(Date.now() >>> 0))))
  const kinds = new Set(
    opt('--kinds', 'h,c')
      .split(',')
      .filter((k) => k === 'h' || k === 'c')
      .map((k) => (k === 'h' ? 'hot' : 'cold')),
  ) as Set<'hot' | 'cold'>
  const { best, hall } = await geneticSolve({
    level,
    levelFile,
    n,
    budgetMs,
    workerCount: workers,
    rng,
    kinds,
    solveCap,
    onStatus: (gen, ms, best, restart) => {
      if (restart) console.log(`[solve] 第 ${gen} 代 · 停滞重启（重随机）`)
      else console.log(`[solve] 第 ${gen} 代 · ${(ms / 1000).toFixed(0)}s · 最优 ${best ? fmt(best.m) : '—'}`)
    },
  })
  if (best && best.m.won) {
    const fine = evalCandidate(level, best.src, { dt: FINE_DT, cap: 120 })
    console.log(`[solve] 最优（${workers} worker 并行）：${srcComma(best.src)}`)
    console.log(`[solve] 粗筛 ${fmt(best.m)} → 精验 ${fmt(fine)}`)
    if (hall.length > 1) {
      console.log('[solve] 候选榜（按质量排序，可逐一 --verify --robust 复核）：')
      hall.forEach((h, i) => {
        console.log(`  #${i + 1} ${srcComma(h.src)} → ${fmt(h.m)}`)
      })
    }
  } else {
    console.log(`[solve] ${(budgetMs / 1000).toFixed(0)}s 内未找到可通关摆法（当前最佳：${best ? fmt(best.m) : '无'}）`)
  }
}

async function cmdRefine() {
  const raw = opt('--refine')
  // 无参（或后跟其他选项）时以 known-solutions.ts 登记解为种子，继续优化
  const start = raw && !raw.startsWith('--') ? parseSources(raw) : (KNOWN_SOLUTIONS[level.id]?.src ?? [])
  if (start.length === 0) {
    console.log('[refine] 基线无源：无坐标可动、无源可删，无优化空间')
    return
  }
  const cap = Number(opt('--refine-cap', '90'))
  const budgetMs = Number(opt('--refine-ms', '180000'))
  const { base, cur, evalCount, elapsedMs } = await refineSolution({
    level,
    levelFile,
    start,
    cap,
    budgetMs,
    workerCount: workerCount(),
    onBaseline: (m) => {
      console.log(`[refine] 基线：${fmtTotal(start, m)}`)
      if (!m.won) {
        console.log(`[refine] 基线在 cap=${cap}s 内未通关（玩家实局可能依赖飞行中放置的时序，无头评估源在 t=0 全放）——按进展序继续搜索，直到爬进通关`)
      }
    },
    onImprove: (step, c) => {
      console.log(`[refine] 步长 ${step} 改进：${solutionUrl(c.src)} → ${fmtTotal(c.src, c.m)}`)
    },
  })
  console.log(`[refine] 完成：${evalCount} 次评估 · ${(elapsedMs / 1000).toFixed(0)}s · 步长 ${REFINE_STEPS.join('/')}`)
  if (cur === base) {
    console.log('[refine] 未找到优于基线的摆法（邻域内已局部最优）')
  } else {
    console.log(`[refine] 总耗时 ${totalTime(base.m).toFixed(1)}s → ${totalTime(cur.m).toFixed(1)}s`)
  }
  console.log(`[refine] 最优摆法（URL s= 形态）：${solutionUrl(cur.src)}`)
  console.log(`[refine] 最优摆法（--verify 逗号形态）：${srcComma(cur.src)}`)
}

await initBackend()
if (args.includes('--sim')) cmdSim()
if (args.includes('--verify')) cmdVerify()
if (args.includes('--verify-known')) cmdVerifyKnown()
if (args.includes('--solve')) await cmdSolve()
if (args.includes('--refine')) await cmdRefine()
