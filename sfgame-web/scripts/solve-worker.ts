// --solve 并行评估子进程：stdin/stdout 逐行 JSON（{"id","src"} → {"id","m"}），与主进程共用 solve-lib 评估；必须 FINE_DT 精筛步长（粗筛是"另一套物理"，会假阴性）
import { createInterface } from 'node:readline'
import { evalCandidate, FINE_DT, initBackend, loadLevel, type CandidateMetric, type SourceTuple } from './solve-lib.ts'
import { createEngine } from '../app/wasm/engine.ts'

const file = process.argv[2]
if (!file) {
  console.error('solve-worker：缺少关卡文件参数')
  process.exit(1)
}
await initBackend()
const level = loadLevel(file)
// 顺序评估全程复用一个引擎实例：免每次评估重建 wasm 实例 + 32MB 钉死内存
const engine = createEngine()

interface Job {
  id: number
  src: SourceTuple[]
  // 可选：--refine 下发长 cap；缺省 35s 快筛
  cap?: number
  // 搜索侧恒开早停（worker 只服务搜索，verify 走主进程 evalCandidate）
  earlyExit?: boolean
}

const rl = createInterface({ input: process.stdin })
for await (const line of rl) {
  if (!line.trim()) continue
  let job: Job
  try {
    job = JSON.parse(line) as Job
  } catch {
    continue
  }
  // cap 缺省 35s（调用方 --solve/--refine 均显式下发；--solve 默认 90s，--refine 用长 cap）
  const m: CandidateMetric = evalCandidate(level, job.src, { dt: FINE_DT, cap: job.cap ?? 35, earlyExit: job.earlyExit ?? true }, engine)
  console.log(JSON.stringify({ id: job.id, m }))
}
