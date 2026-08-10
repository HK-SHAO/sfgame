import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { GameLoop, SIM_DT } from '../app/core/loop.ts'

let rafCb: FrameRequestCallback | null = null
let nowMs = 0

beforeEach(() => {
  rafCb = null
  nowMs = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafCb = cb
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('performance', { now: () => nowMs })
  vi.stubGlobal('setTimeout', (cb: () => void) => {
    cb()
    return 0
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function frame(dtMs: number) {
  nowMs += dtMs
  const cb = rafCb!
  rafCb = null
  cb(nowMs)
}

// dt 恒定 SIM_DT 是轨迹位级一致（与速率无关）的前提
test('定步长：任何速率 dt 恒为 SIM_DT，tick 数随速率比例，0.5× 隔帧步进', () => {
  const dts: number[] = []
  let renders = 0
  const loop = new GameLoop({
    tick: (dt) => dts.push(dt),
    render: () => renders++,
  })
  loop.start()
  for (let i = 0; i < 3; i++) frame(17)
  expect(dts).toHaveLength(3)
  expect(dts.every((d) => d === SIM_DT)).toBe(true)
  expect(renders).toBe(3)

  const dts2: number[] = []
  const loop2 = new GameLoop({
    tick: (dt) => dts2.push(dt),
    render: () => {},
  })
  loop2.setRate(2)
  loop2.start()
  for (let i = 0; i < 3; i++) frame(17)
  expect(dts2).toHaveLength(6)
  expect(dts2.every((d) => d === SIM_DT)).toBe(true)

  let ticks = 0
  let halfRenders = 0
  const loop3 = new GameLoop({
    tick: () => ticks++,
    render: () => halfRenders++,
  })
  loop3.setRate(0.5)
  loop3.start()
  for (let i = 0; i < 4; i++) frame(17)
  expect(ticks).toBe(2)
  expect(halfRenders).toBe(2)
})

test('追帧封顶：单帧最多 24 步；欠账封顶不超单帧量，切回 1× 下一帧即回落', () => {
  let ticks = 0
  const loop = new GameLoop({ tick: () => ticks++, render: () => {} })
  loop.setRate(16)
  loop.start()
  frame(300)
  expect(ticks).toBe(24)
  // 16× 低帧率（50ms/帧，需 48 步）持续运行：欠账钉在封顶，每帧仍只消化 24
  for (let i = 0; i < 10; i++) frame(50)
  let before = ticks
  frame(50)
  expect(ticks - before).toBe(24)
  // 切回 1×：欠账已封顶消化完，下一帧立即回到 1× 节奏（50ms ≈ 3 步），不再满转还债
  loop.setRate(1)
  before = ticks
  frame(50)
  expect(ticks - before).toBeLessThanOrEqual(4)
})
