export interface LoopHandlers {
  tick: (dt: number) => void
  render: () => void
}

export const SIM_DT = 1 / 60
const SIM_DT_MS = SIM_DT * 1000
const MAX_FRAME = 0.25
// 追赶封顶：慢帧欠账顺延后续帧逐步消化，避免单帧追帧爆成几十毫秒
const MAX_TICKS_PER_FRAME = 24
// 欠账上限 = 单帧封顶量：高倍速低帧率时超出部分丢时间（时间膨胀）而非无限累积——
// 否则切回低倍速后仍按封顶满转还债数秒，视觉上倍速切换延迟生效
const MAX_ACC = MAX_TICKS_PER_FRAME * SIM_DT
// 高速率下每批 TICKS_PER_TASK 步后 setTimeout(0) 让出主线程，防长任务冻结 UI
const TICKS_PER_TASK = 6

// 定步长：每 tick dt 恒为 SIM_DT，倍速只改 tick 频率，轨迹位级一致
export class GameLoop {
  private handlers: LoopHandlers
  private rafId = 0
  private last = 0
  private acc = 0
  private running = false
  private rate = 1
  private lastRender = -Infinity
  private frameTicks = 0
  private static readonly RENDER_MIN_INTERVAL = SIM_DT_MS - 1

  constructor(handlers: LoopHandlers) {
    this.handlers = handlers
  }

  setRate(rate: number) {
    this.rate = rate
  }

  start() {
    if (this.running) return
    this.running = true
    this.last = performance.now()
    this.acc = 0
    this.lastRender = -Infinity
    this.rafId = requestAnimationFrame(this.frame)
  }

  stop() {
    if (!this.running) return
    this.running = false
    cancelAnimationFrame(this.rafId)
  }

  private frame = (now: number) => {
    if (!this.running) return
    try {
      this.frameInner(now)
    } catch (e) {
      console.error('游戏循环异常：', e)
      this.stop()
    }
  }

  private frameInner(now: number) {
    let frameDt = (now - this.last) / 1000
    this.last = now
    if (frameDt > MAX_FRAME) frameDt = MAX_FRAME
    if (frameDt < 0) frameDt = 0
    this.acc += frameDt * this.rate
    if (this.acc > MAX_ACC) this.acc = MAX_ACC
    this.frameTicks = 0
    this.runTicks(now)
  }

  private runTicks(now: number) {
    if (!this.running) return
    let stepped = false
    let ticks = 0
    while (this.acc >= SIM_DT && ticks < TICKS_PER_TASK && this.frameTicks < MAX_TICKS_PER_FRAME) {
      this.handlers.tick(SIM_DT)
      this.acc -= SIM_DT
      this.frameTicks++
      stepped = true
      ticks++
    }
    const done = this.acc < SIM_DT || this.frameTicks >= MAX_TICKS_PER_FRAME
    if (!done) {
      setTimeout(() => this.runTicks(now), 0)
      return
    }
    if (stepped && now - this.lastRender >= GameLoop.RENDER_MIN_INTERVAL) {
      this.handlers.render()
      this.lastRender = now
    }
    this.rafId = requestAnimationFrame(this.frame)
  }
}
