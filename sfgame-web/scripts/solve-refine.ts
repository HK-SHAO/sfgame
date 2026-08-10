// 坐标下降精炼搜索引擎（run-level --refine）：以玩家解/已知解为种子局部优化。
// 目标字典序：通关 → 总耗时（通关时间 + 源罚 4s/个 + 贴地罚 1s/s）最短 → 耗时；路程不参与排序。
// 邻域 = 单源单轴 ±step（粗到细）+ 删一源；memo 缓存去重评（排序规范化键 = 同一多重集同键）、worker 并行。
// 纯搜索无 I/O：基线/改进经回调上报，打印归 CLI
import { totalTime, WorkerPool, type CandidateMetric, type SourceTuple } from './solve-lib.ts'
import type { LevelDef } from '../app/game/types.ts'

export const REFINE_STEPS = [2, 1, 0.5, 0.2, 0.1]

export interface Refined {
  src: SourceTuple[]
  m: CandidateMetric
}

export interface RefineResult {
  base: Refined
  cur: Refined
  evalCount: number
  elapsedMs: number
}

export interface RefineOptions {
  level: LevelDef
  levelFile: string
  start: SourceTuple[]
  cap: number
  budgetMs: number
  workerCount: number
  onBaseline?: (m: CandidateMetric) => void
  onImprove?: (step: number, cur: Refined) => void
}

function refineBetter(a: Refined, b: Refined): boolean {
  if (a.m.won !== b.m.won) return a.m.won
  if (!a.m.won) return a.m.progress > b.m.progress
  const ta = totalTime(a.m)
  const tb = totalTime(b.m)
  if (ta !== tb) return ta < tb
  return a.m.time < b.m.time
}

// 缓存键：排序规范化（同一多重集同键）+ 1 位小数（URL 可放置形态）
function srcKeySorted(src: SourceTuple[]): string {
  return src
    .map((s) => `${+s[0].toFixed(1)},${+s[1].toFixed(1)},${s[2]}`)
    .sort()
    .join('_')
}

function refineNeighbors(level: LevelDef, src: SourceTuple[], step: number): SourceTuple[][] {
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

export async function refineSolution(opts: RefineOptions): Promise<RefineResult> {
  const { level, levelFile, start, cap, budgetMs, workerCount, onBaseline, onImprove } = opts
  const t0 = performance.now()
  const deadline = t0 + budgetMs
  const pool = new WorkerPool(levelFile, workerCount)
  const cache = new Map<string, CandidateMetric>()
  let evalCount = 0
  // 缓存门控：只评估未见过的摆法
  const evalMany = async (list: SourceTuple[][]): Promise<CandidateMetric[]> => {
    const fresh = list.filter((s) => !cache.has(srcKeySorted(s)))
    if (fresh.length > 0) {
      const ms = await pool.evaluate(fresh, cap)
      fresh.forEach((s, i) => cache.set(srcKeySorted(s), ms[i]))
      evalCount += fresh.length
    }
    return list.map((s) => cache.get(srcKeySorted(s))!)
  }

  const [m0] = await evalMany([start])
  onBaseline?.(m0)
  let cur: Refined = { src: start, m: m0 }
  const base = cur

  for (const step of REFINE_STEPS) {
    let moved = true
    while (moved && performance.now() < deadline) {
      moved = false
      const cands = refineNeighbors(level, cur.src, step)
      const ms = await evalMany(cands)
      let best = cur
      for (let i = 0; i < cands.length; i++) {
        const e: Refined = { src: cands[i], m: ms[i] }
        if (refineBetter(e, best)) best = e
      }
      if (best !== cur) {
        cur = best
        moved = true
        onImprove?.(step, cur)
      }
    }
  }
  await pool.close()
  return { base, cur, evalCount, elapsedMs: performance.now() - t0 }
}
