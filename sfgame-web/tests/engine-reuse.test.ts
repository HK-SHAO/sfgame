import { expect, test } from 'vitest'
import { KNOWN_SOLUTIONS } from '../scripts/known-solutions.ts'
import { evalCandidate, loadLevel } from '../scripts/solve-lib.ts'
import { createEngine } from '../app/wasm/engine.ts'

const opts = { dt: 1 / 60, cap: 120 }

// 跨关复用引擎的泄漏回归（P6）：同引擎顺序跑不同关卡，第二关结果必须与独立引擎一致。
// 根因曾为 q1/q2 平流 scratch 只在空气格写、回推采样读固体格的旧关残留——init 全量复位后钉死
test('同一引擎跨关卡复用：第二关与独立实例逐位同结果', () => {
  const engine = createEngine()
  const first = evalCandidate(loadLevel('levels/level-1.json'), KNOWN_SOLUTIONS['luo-yu'].src, opts, engine)
  expect(first.won).toBe(true)
  const reused = evalCandidate(loadLevel('levels/level-2.json'), KNOWN_SOLUTIONS['fu-yao'].src, opts, engine)
  const fresh = evalCandidate(
    loadLevel('levels/level-2.json'),
    KNOWN_SOLUTIONS['fu-yao'].src,
    opts,
    createEngine(),
  )
  expect(reused.won).toBe(true)
  expect(reused.time).toBe(fresh.time)
}, 30000)
