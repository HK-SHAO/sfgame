/**
 * 搜索 worker：run-level.ts --solve 的并行评估子进程。
 * 协议：stdin 逐行读入 `{"id":n,"src":[[x,y,k],...]}`，
 * stdout 逐行回 `{"id":n,"m":{won,time,pathLen,groundTime,progress}}`。
 * 与主进程同用 solve-lib 的评估函数，保证指标口径一致。
 *
 * 注意：评估必须用精筛 dt=1/60（与浏览器固定步长一致）——粗筛 dt=1/30
 * 是"另一套物理"（pitfalls G6），连已知参考解都会假阴性，不能用于搜索。
 */
import { createInterface } from 'node:readline'
import { evalCandidate, FINE_DT, loadLevel, type CandidateMetric, type SourceTuple } from './solve-lib'

const file = process.argv[2]
if (!file) {
  console.error('solve-worker：缺少关卡文件参数')
  process.exit(1)
}
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
  // 搜索用 cap 35s + 贴地早退：教学关参考解实测 ≤24s，35s 留足余量
  const m: CandidateMetric = evalCandidate(level, job.src, { dt: FINE_DT, cap: 35, earlyExitGround: true })
  console.log(JSON.stringify({ id: job.id, m }))
}
