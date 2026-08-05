import { readFileSync } from 'node:fs'
import { levelFromJson, parseLevelText } from '../src/game/level-format'
import { LevelSimulation } from '../src/game/simulation'
import type { LevelDef } from '../src/game/types'

/** 细验证步长：与浏览器固定步长 SIM_DT 一致（无头 ↔ 真机逐位相同）。 */
export const FINE_DT = 1 / 60
/** 粗筛步长：只用于砍掉明显不行的组合，胜点必须 FINE_DT 精验（pitfalls G6）。 */
export const COARSE_DT = 1 / 30

export type SourceTuple = [number, number, 'hot' | 'cold']

/** 一次模拟的评估结果：除"能否通关"外，还带路程/贴地/耗时三个质量维度。 */
export interface CandidateMetric {
  won: boolean
  /** 通关时刻（秒，与 YAML winTime 同约定：胜步起始的模拟时钟） */
  time: number
  /** 全程路程（世界单位）：回头路越多越大，是"平稳度"的第一代理 */
  pathLen: number
  /** 贴地（离地 < 1 世界单位）累计秒数：避免贴地滑行的第二代理 */
  groundTime: number
  /** 未通关时的进展（站点数 ×1000 + 横向位移），供种群引导 */
  progress: number
}

export function loadLevel(file: string): LevelDef {
  return levelFromJson(parseLevelText(readFileSync(file, 'utf8')))
}

export interface EvalOptions {
  dt?: number
  cap?: number
  /**
   * 贴地早退（仅搜索粗筛用）：飞机持续贴地 8s 且期间没抵达新站点、
   * 横向位移 < 5，判为死局提前终止——G8 物理下贴地飞机几乎不可能
   * 自己重新起飞，不必跑满 cap。最终胜点仍走 120s 精验兜底。
   */
  earlyExitGround?: boolean
}

/** 一次性放置全部源，跑确定性模拟并统计三项质量指标。 */
export function evalCandidate(
  level: LevelDef,
  src: SourceTuple[],
  opts: EvalOptions = {},
): CandidateMetric {
  const dt = opts.dt ?? FINE_DT
  const cap = opts.cap ?? 120
  const sim = new LevelSimulation(level)
  // 坐标统一舍入到 1 位小数：解法参考页的 URL 只保留 1 位小数，
  // 候选解必须"URL 可放置"才有效（3 位小数的刀刃解玩家无法复现）
  for (const [x, y, k] of src) {
    const placed = sim.placeSource(Math.round(x * 10) / 10, Math.round(y * 10) / 10, k)
    if (!placed) {
      // 玩家放置会被拒绝（预算/间距/合法性），候选不可复现，直接判无效
      return { won: false, time: -1, pathLen: 0, groundTime: 0, progress: 0 }
    }
  }
  let pathLen = 0
  let groundTime = 0
  let px = sim.plane.x
  let py = sim.plane.y
  let groundedFor = 0
  let groundStartX = sim.plane.x
  let groundVisited = 0
  for (let t = 0; t < cap; t += dt) {
    const stepStart = sim.time
    sim.step(dt)
    const p = sim.plane
    pathLen += Math.hypot(p.x - px, p.y - py)
    const alt = level.ground(p.x) - p.y
    if (alt < 1) {
      groundTime += dt
      groundedFor += dt
      if (groundedFor === dt) {
        groundStartX = p.x
        groundVisited = sim.visitedCount
      } else if (
        opts.earlyExitGround &&
        groundedFor > 8 &&
        sim.visitedCount === groundVisited &&
        Math.abs(p.x - groundStartX) < 5
      ) {
        return {
          won: false,
          time: -1,
          pathLen,
          groundTime,
          progress: sim.visitedCount * 1000 + Math.min(p.x, level.world.w),
        }
      }
    } else {
      groundedFor = 0
    }
    px = p.x
    py = p.y
    if (sim.phase === 'won') {
      return { won: true, time: stepStart, pathLen, groundTime, progress: level.goals.length }
    }
  }
  return {
    won: false,
    time: -1,
    pathLen,
    groundTime,
    progress: sim.visitedCount * 1000 + Math.min(sim.plane.x, level.world.w),
  }
}

/**
 * 参考解质量门槛：贴地累计 ≤ 1.5s 视为"基本全程飞行"（硬性舒适底线）。
 * 纯字面"路程优先"经实测会选出病理解：
 * 1) L1 贴地爬行 14s 的"短路程"解（118.9）压过全程飞行的干净解（125.2）；
 * 2) L2 路程 72.1 但耗时 27.5s 的解压过路程 79.4 但耗时 14.1s 的解。
 * 两者都违背"更平稳、更舒服"的初衷，故：飞行门槛之后，用
 * 组合质量 `路程 + 0.8×耗时` 排序——1s 耗时 ≈ 0.8 世界单位路程，
 * 短 1 单位路程不会换来慢 10 秒，快 10 秒值得多走 8 单位。
 */
export const GROUND_COMFORT_MAX = 1.5
/** 组合质量中耗时的权重（世界单位/秒） */
export const TIME_WEIGHT = 0.8

/**
 * 多目标优劣比较（参考答案优先级，老大 #10 验收第 2 条 + 舒适底线）：
 * 1) 能否通关；2) 是否基本全程飞行（贴地 ≤ GROUND_COMFORT_MAX）；
 * 3) 组合质量（路程为主、耗时次之）；未通关的候选只按进展比较。
 * 未通关的候选只按进展互相比较。
 */
export function better(a: CandidateMetric, b: CandidateMetric): boolean {
  if (a.won !== b.won) return a.won
  if (a.won) {
    const aFly = a.groundTime <= GROUND_COMFORT_MAX
    const bFly = b.groundTime <= GROUND_COMFORT_MAX
    if (aFly !== bFly) return aFly
    const qa = a.pathLen + TIME_WEIGHT * a.time
    const qb = b.pathLen + TIME_WEIGHT * b.time
    if (qa !== qb) return qa < qb
    if (a.groundTime !== b.groundTime) return a.groundTime < b.groundTime
    return a.time < b.time
  }
  return a.progress > b.progress
}

/** 候选源网格：x 每 2 单位一列，每列取 贴地 / 中空 / 高空 三档高度，热冷各一。 */
export function spotGrid(level: LevelDef): SourceTuple[] {
  const spots: SourceTuple[] = []
  for (let x = 4; x <= level.world.w - 4; x += 2) {
    for (const dy of [0.7, 8, 16]) {
      const y = Math.max(3, level.ground(x) - dy)
      spots.push([x, y, 'hot'], [x, y, 'cold'])
    }
  }
  return spots
}

/** 确定性伪随机（搜索可复现；种子默认时间戳）。 */
export function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
