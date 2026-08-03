export interface LoopHandlers {
  /** 固定步长模拟 tick，dt 恒为 SIM_DT（秒） */
  tick: (dt: number) => void
  /** 每个动画帧调用一次 */
  render: () => void
}

export const SIM_DT = 1 / 60
const MAX_FRAME = 0.25

/**
 * 固定步长游戏循环：模拟以 60Hz 稳定推进，渲染跟随显示器刷新率。
 * 页面切后台时 rAF 自动暂停，恢复后由 MAX_FRAME 截断避免时间突进。
 */
export class GameLoop {
  private handlers: LoopHandlers
  private rafId = 0
  private last = 0
  private acc = 0
  private running = false

  constructor(handlers: LoopHandlers) {
    this.handlers = handlers
  }

  start() {
    if (this.running) return
    this.running = true
    this.last = performance.now()
    this.acc = 0
    this.rafId = requestAnimationFrame(this.frame)
  }

  stop() {
    if (!this.running) return
    this.running = false
    cancelAnimationFrame(this.rafId)
  }

  private frame = (now: number) => {
    if (!this.running) return
    let frameDt = (now - this.last) / 1000
    this.last = now
    if (frameDt > MAX_FRAME) frameDt = MAX_FRAME
    if (frameDt < 0) frameDt = 0
    this.acc += frameDt
    while (this.acc >= SIM_DT) {
      this.handlers.tick(SIM_DT)
      this.acc -= SIM_DT
    }
    this.handlers.render()
    this.rafId = requestAnimationFrame(this.frame)
  }
}
