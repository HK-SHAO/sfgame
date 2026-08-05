import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { GameLoop, SIM_DT } from '../src/core/loop'

/** rAF 桩：手动驱动帧时间，帧内回调按顺序调用。 */
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
  // 默认 setTimeout 同步执行：高速率分批续跑在测试里立即可见（生产是真实让出主线程）
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

function run(count: number, dtMs: number) {
  for (let i = 0; i < count; i++) frame(dtMs)
}

test('1×：60Hz 帧每帧一个 tick，dt 恒为 SIM_DT，渲染跟随', () => {
  const dts: number[] = []
  let renders = 0
  const loop = new GameLoop({
    tick: (dt) => dts.push(dt),
    render: () => renders++,
  })
  loop.start()
  run(3, 17)
  expect(dts).toHaveLength(3)
  expect(dts.every((d) => d === SIM_DT)).toBe(true)
  expect(renders).toBe(3)
})

test('2×：每 60Hz 帧两个 tick，dt 不变（轨迹位级一致）', () => {
  const dts: number[] = []
  let renders = 0
  const loop = new GameLoop({
    tick: (dt) => dts.push(dt),
    render: () => renders++,
  })
  loop.setRate(2)
  loop.start()
  run(3, 17)
  expect(dts).toHaveLength(6)
  expect(dts.every((d) => d === SIM_DT)).toBe(true)
  expect(renders).toBe(3)
})

test('4×：每 60Hz 帧四个 tick', () => {
  let ticks = 0
  const loop = new GameLoop({ tick: () => ticks++, render: () => {} })
  loop.setRate(4)
  loop.start()
  run(3, 17)
  expect(ticks).toBe(12)
})

test('0.5×：每两帧一个 tick，渲染只在步进帧', () => {
  let ticks = 0
  let renders = 0
  const loop = new GameLoop({
    tick: () => ticks++,
    render: () => renders++,
  })
  loop.setRate(0.5)
  loop.start()
  run(4, 17)
  expect(ticks).toBe(2)
  expect(renders).toBe(2)
})

test('运行中切换速率：模拟时间按 tick 累计，不跳变', () => {
  let ticks = 0
  const loop = new GameLoop({ tick: () => ticks++, render: () => {} })
  loop.setRate(2)
  loop.start()
  frame(17) // 2 tick
  loop.setRate(1)
  frame(17) // 1 tick
  loop.setRate(0.5)
  frame(17)
  frame(17) // 1 tick
  expect(ticks).toBe(4)
})

test('渲染封顶 60Hz：120Hz 刷新 + 2× 每帧步进，渲染只每两帧一次', () => {
  let ticks = 0
  let renders = 0
  const loop = new GameLoop({
    tick: () => ticks++,
    render: () => renders++,
  })
  loop.setRate(2)
  loop.start()
  run(6, 8.5)
  expect(ticks).toBe(6)
  expect(renders).toBe(3)
})

test('16×：60Hz 帧十六个 tick', () => {
  let ticks = 0
  const loop = new GameLoop({ tick: () => ticks++, render: () => {} })
  loop.setRate(16)
  loop.start()
  run(2, 17)
  expect(ticks).toBe(32)
})

test('暂停回归的追赶尖峰封顶：单帧最多消化 24 步，剩余留待下帧（不爆帧）', () => {
  let ticks = 0
  const loop = new GameLoop({ tick: () => ticks++, render: () => {} })
  loop.setRate(16)
  loop.start()
  frame(300) // 0.3s×16 = 4.8s 模拟 ≈ 288 步，单帧封顶 24（防倍速追帧爆帧）
  expect(ticks).toBe(24)
  frame(17)
  expect(ticks).toBe(48) // pending 仍超封顶，继续消化
  run(40, 17)
  // 总模拟时间 ≈ 16s，全部消化完毕（>800 证明未丢弃 pending、封顶已释放）
  expect(ticks).toBeGreaterThan(800)
})

test('高速率分批：单任务最多 6 步，余量经 setTimeout 续跑（UI 不被长任务堵死）', () => {
  let ticks = 0
  const pending: Array<() => void> = []
  vi.stubGlobal('setTimeout', (cb: () => void) => {
    pending.push(cb)
    return 0
  })
  const loop = new GameLoop({ tick: () => ticks++, render: () => {} })
  loop.setRate(16)
  loop.start()
  frame(17) // 16 步预算，但单任务只同步跑 6 步
  expect(ticks).toBe(6)
  pending.shift()!()
  expect(ticks).toBe(12)
  pending.shift()!()
  expect(ticks).toBe(16) // 本帧预算消化完，无遗留续跑
  expect(pending).toHaveLength(0)
})
