// --solve 并行评估子进程：stdin/stdout 逐行 JSON（{"id","src"} → {"id","m"}），与主进程共用 solve-lib 评估；必须 FINE_DT 精筛步长（粗筛是"另一套物理"，会假阴性）
import { createInterface } from 'node:readline'
import { evalCandidate, FINE_DT, initBackend, loadLevel, type CandidateMetric, type SourceTuple } from './solve-lib'

const file = process.argv[2]
if (!file) {
  console.error('solve-worker：缺少关卡文件参数')
  process.exit(1)
}
await initBackend()
const level = loadLevel(file)

interface Job {
  id: number
  src: SourceTuple[]
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
  // cap 35s：参考解实测 ≤24s，留足余量；新物理（#25）下贴地可被风重新带飞，不再设贴地早退
  const m: CandidateMetric = evalCandidate(level, job.src, { dt: FINE_DT, cap: 35 })
  console.log(JSON.stringify({ id: job.id, m }))
}
