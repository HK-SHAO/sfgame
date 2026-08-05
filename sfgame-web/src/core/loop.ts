export interface LoopHandlers {
  /** 固定步长模拟 tick，dt 恒为 SIM_DT（秒） */
  tick: (dt: number) => void
  render: () => void
}

export const SIM_DT = 1 / 60
const SIM_DT_MS = SIM_DT * 1000
const MAX_FRAME = 0.25
/**
 * 单帧最多模拟步数的硬上限：慢帧后 acc 可堆积最多 MAX_FRAME×rate 欠账，
 * 一次性追完会单帧爆成几十毫秒——倍速下的"卡"多源于此追帧爆帧。封顶后
 * 余下欠账顺延到后续帧逐步消化（短暂慢放，不爆帧）；稳态 16× 不触顶。
 */
const MAX_TICKS_PER_FRAME = 24

/**
 * 固定步长游戏循环：模拟 60Hz 推进，渲染跟随刷新率；切后台 rAF 暂停，恢复由 MAX_FRAME 截断。
 * 倍速只改每真实秒的 tick 数，每 tick dt 恒为 SIM_DT——"速率不影响轨迹"的根源。
 * 渲染只在模拟步进过的帧执行：120Hz 屏 rAF 两倍触发，若每帧渲染则 Canvas 工作量翻倍
 * （持续高负载 → 发热降频 → 帧率恶化）；倍速下每帧都步进，渲染因此再封顶 60Hz。
 */
export class GameLoop {
  private handlers: LoopHandlers
  private rafId = 0
  private last = 0
  private acc = 0
  private running = false
  private rate = 1
  private lastRender = -Infinity
  /**
   * 渲染最小间隔 = SIM_DT_MS - 1ms 容差：120Hz 屏（8.3ms）隔帧防双倍渲染负载；
   * 60Hz 屏 rAF 有 ±1ms 抖动，精确 >=16.67 会跳过半数渲染（16/33ms 交替似 30fps 卡顿），
   * 容差后 60Hz 每帧必渲。只决定"何时画"，不影响物理。
   */
  private static readonly RENDER_MIN_INTERVAL = SIM_DT_MS - 1

  constructor(handlers: LoopHandlers) {
    this.handlers = handlers
  }

  /** 游戏速率倍数（每真实秒的模拟 tick 数 = 60 × rate）。 */
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
      // 渲染/模拟抛错会中断 rAF 链（画面冻结且无提示）——显式上报便于诊断
      console.error('游戏循环异常：', e)
      this.stop()
    }
  }

  private frameInner(now: number) {
    this.frameCount++
    let frameDt = (now - this.last) / 1000
    this.last = now
    if (frameDt > MAX_FRAME) frameDt = MAX_FRAME
    if (frameDt < 0) frameDt = 0
    this.acc += frameDt * this.rate
    let stepped = false
    let ticks = 0
    while (this.acc >= SIM_DT && ticks < MAX_TICKS_PER_FRAME) {
      this.handlers.tick(SIM_DT)
      this.acc -= SIM_DT
      stepped = true
      ticks++
    }
    if (stepped && now - this.lastRender >= GameLoop.RENDER_MIN_INTERVAL) {
      this.handlers.render()
      this.renderCount++
      this.lastRender = now
    }
    this.rafId = requestAnimationFrame(this.frame)
  }

  /** ?perf 诊断：rAF 帧数与实际渲染数（验证节流/门控行为） */
  frameCount = 0
  renderCount = 0
}
