import { readFileSync } from 'node:fs'
import { GROUND_PENALTY_RATE, SOURCE_PENALTY } from '../app/game/timer'
import { levelFromJson, parseLevelText } from '../app/game/level-format'
import { LevelSimulation } from '../app/game/simulation'
import type { LevelDef } from '../app/game/types'
import { bootEngine } from '../app/wasm/engine'

// FINE_DT 与浏览器固定步长 SIM_DT 一致（无头 ↔ 真机同语义）；粗筛是"另一套物理"，胜点必须 FINE_DT 精验
export const FINE_DT = 1 / 60

// 无头引导：wasm 缺失/不可用直接抛错——脚本场景下无声回退等于产出假结果
export async function initBackend(): Promise<void> {
  const ok = await bootEngine(() =>
    Promise.resolve(readFileSync(`${import.meta.dir}/../app/wasm/sfengine.wasm`)),
  )
  if (!ok) throw new Error('WASM 引擎（sfengine.wasm）加载失败，请先 bun run build:wasm')
}

export type SourceTuple = [number, number, 'hot' | 'cold']

export interface CandidateMetric {
  won: boolean
  time: number
  pathLen: number
  groundTime: number
  progress: number
  // 源个数：耗时优先级按"总耗时 = time + 罚时×源数"排序，评估时带上以便跨源数比较
  sources: number
}

export function loadLevel(file: string): LevelDef {
  return levelFromJson(parseLevelText(readFileSync(file, 'utf8')), true)
}

export interface EvalOptions {
  dt?: number
  cap?: number
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
      return { won: false, time: -1, pathLen: 0, groundTime: 0, progress: 0, sources: src.length }
    }
  }
  let pathLen = 0
  let groundTime = 0
  let px = sim.plane.x
  let py = sim.plane.y
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
    if (alt < 1) groundTime += dt
    px = p.x
    py = p.y
    if (sim.phase === 'won') {
      return { won: true, time: stepStart, pathLen, groundTime, progress: level.goals.length, sources: src.length }
    }
  }
  return {
    won: false,
    time: -1,
    pathLen,
    groundTime,
    progress: sim.visitedCount * 1000 + Math.min(sim.plane.x, level.world.w),
    sources: src.length,
  }
}

// 解质量只看总耗时（与游戏罚时同源，见 app/game/timer.ts）：总耗时 = 通关时间 + 源罚 4s/个 + 贴地罚 1s/s。
// 贴地罚时是"软成本"：爬行解物理上就慢，贴地秒数再逐秒加罚，无需硬性飞行门槛
export function totalTime(m: CandidateMetric): number {
  return m.time + SOURCE_PENALTY * m.sources + GROUND_PENALTY_RATE * m.groundTime
}

export function better(a: CandidateMetric, b: CandidateMetric): boolean {
  if (a.won !== b.won) return a.won
  if (a.won) {
    const ta = totalTime(a)
    const tb = totalTime(b)
    if (ta !== tb) return ta < tb
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

export const FALLBACK_METRIC: CandidateMetric = { won: false, time: -1, pathLen: 0, groundTime: 0, progress: 0, sources: 0 }

// 并行评估子进程池：stdin/stdout 逐行 JSON；worker 意外退出时在途任务按失败计并补起替身（否则 Promise 永不 resolve 无声挂死）。
// cap 随任务下发：--solve 用 35s 快筛，--refine 用长 cap（既有解耗时可能超 35s）
export class WorkerPool {
  private procs: Array<{ proc: import('bun').Subprocess; buf: string; idle: boolean; jobId: number }> = []
  private queue: Array<{ src: SourceTuple[]; cap?: number; resolve: (m: CandidateMetric) => void }> = []
  private closed = false
  private levelFile: string

  constructor(levelFile: string, count: number) {
    this.levelFile = levelFile
    for (let i = 0; i < count; i++) this.spawn()
  }

  private spawn() {
    const proc = Bun.spawn([process.execPath, `${import.meta.dir}/solve-worker.ts`, this.levelFile], {
      cwd: import.meta.dir,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const w = { proc, buf: '', idle: true, jobId: 0 }
    this.procs.push(w)
    void proc.exited.then(() => {
      if (this.closed) return
      const i = this.procs.indexOf(w)
      if (i >= 0) this.procs.splice(i, 1)
      if (w.jobId > 0 && this.pending.has(w.jobId)) {
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
      this.pending.set(id, job.resolve)
      if (w.proc.stdin && typeof w.proc.stdin !== 'number') {
        w.proc.stdin.write(`${JSON.stringify({ id, src: job.src, cap: job.cap })}\n`)
        w.proc.stdin.flush()
      }
    }
  }

  evaluate(list: SourceTuple[][], cap?: number): Promise<CandidateMetric[]> {
    if (list.length === 0) return Promise.resolve([])
    const out = new Array<CandidateMetric>(list.length)
    return new Promise((resolveAll) => {
      let done = 0
      for (let i = 0; i < list.length; i++) {
        this.queue.push({
          src: list[i],
          cap,
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
