import { readFileSync } from 'node:fs'
import { levelFromJson, parseLevelText } from '../src/game/level-format'
import { LevelSimulation } from '../src/game/simulation'
import type { LevelDef } from '../src/game/types'
import { bootWasm } from '../src/sim/fluid'

// FINE_DT 与浏览器固定步长 SIM_DT 一致（无头 ↔ 真机同语义）；COARSE_DT 粗筛是"另一套物理"，胜点必须 FINE_DT 精验
export const FINE_DT = 1 / 60
export const COARSE_DT = 1 / 30

// 无头引导：wasm 缺失/不可用直接抛错——脚本场景下无声回退等于产出假结果
export async function initBackend(): Promise<void> {
  const ok = await bootWasm(() =>
    Promise.resolve(readFileSync(`${import.meta.dir}/../src/sim/wasm/sfsim.wasm`)),
  )
  if (!ok) throw new Error('流体内核（sfsim.wasm）加载失败，请先 bun run build:wasm')
}

export type SourceTuple = [number, number, 'hot' | 'cold']

export interface CandidateMetric {
  won: boolean
  time: number
  pathLen: number
  groundTime: number
  progress: number
}

export function loadLevel(file: string): LevelDef {
  return levelFromJson(parseLevelText(readFileSync(file, 'utf8')))
}

export interface EvalOptions {
  dt?: number
  cap?: number
  earlyExitGround?: boolean
}

export function evalCandidate(
  level: LevelDef,
  src: SourceTuple[],
  opts: EvalOptions = {},
): CandidateMetric {
  const dt = opts.dt ?? FINE_DT
  const cap = opts.cap ?? 120
  const sim = new LevelSimulation(level)
  // 坐标统一舍入到 1 位小数：URL 只保留 1 位小数，候选解必须"URL 可放置"才有效（刀刃解玩家无法复现）
  for (const [x, y, k] of src) {
    const placed = sim.placeSource(Math.round(x * 10) / 10, Math.round(y * 10) / 10, k)
    if (!placed) {
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
    // 流场发散（NaN/Inf）即内核在此运行时不可信：抛错而非继续产出假"通关"
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      throw new Error('流场发散（NaN）：当前运行时无法正确执行 WASM·SIMD 流体内核')
    }
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

// 贴地 ≤1.5s 视为"基本全程飞行"（纯路程优先实测选出贴地爬行/慢速病理解）；飞行门槛后用 路程+TIME_WEIGHT×耗时 排序（1s ≈ 0.8 世界单位）
export const GROUND_COMFORT_MAX = 1.5
export const TIME_WEIGHT = 0.8

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
