export interface LoopHandlers {
  /** 固定步长模拟 tick，dt 恒为 SIM_DT（秒） */
  tick: (dt: number) => void
  /** 每个动画帧调用一次 */
  render: () => void
}

export const SIM_DT = 1 / 60
const SIM_DT_MS = SIM_DT * 1000
const MAX_FRAME = 0.25
/**
 * 单帧最多执行的模拟步数。追帧尖峰的硬上限：
 * 慢帧（GC/热降频/合成）后 acc 会堆积最多 MAX_FRAME×rate 的欠账，
 * 若一次性追完（如 16× 掉一帧 = 240 tick），单帧会爆成几十毫秒——
 * 倍速下的"卡"很大程度来自这个追帧爆帧，而非稳态成本。
 * 24 步封顶后：最坏单帧 = 24×tickCost+渲染（iPhone 上 ≈12ms+，可接受），
 * 余下欠账顺延到后续帧逐步消化（短暂慢放，不爆帧）。
 * 稳态（16× = 16 tick/帧）与暂停回归（MAX_FRAME 截断后 1× = 15 tick）都不触顶。
 */
const MAX_TICKS_PER_FRAME = 24

/**
 * 固定步长游戏循环：模拟以 60Hz 稳定推进，渲染跟随显示器刷新率。
 * 页面切后台时 rAF 自动暂停，恢复后由 MAX_FRAME 截断避免时间突进。
 *
 * 倍速（setRate）只改变每真实秒的 tick 次数，每 tick 的 dt 恒为 SIM_DT：
 * 物理轨迹逐位不变，只是墙上时间快慢不同——这是"速率不影响轨迹"的根源。
 *
 * 渲染只在"模拟步进过的帧"执行：120Hz ProMotion 屏上 rAF 以 120Hz 触发，
 * 但模拟只步进 60Hz，若每帧都渲染，Canvas 2D 工作量为 60fps 的两倍
 * （持续高负载 → 发热降频 → 帧率渐进恶化）。倍速下每帧都步进，
 * 渲染因此再封顶 60Hz，高速率不放大渲染负载。
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
   * 渲染最小间隔：SIM_DT_MS - 1ms 容差。
   * 120Hz 屏 rAF 间隔 8.3ms < 15.7 → 隔帧（防双倍渲染负载）；
   * 60Hz 屏 rAF 间隔 ~16.7ms 但有 ±1ms 抖动（iOS Safari 尤甚），
   * 精确 >=16.67 会跳过半数渲染 → 16/33ms 交替呈现，视觉似 30fps 卡顿；
   * 容差后 60Hz 每帧必渲。物理与动画不受影响（只决定"何时画"）。
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
