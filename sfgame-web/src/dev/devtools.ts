import { sfx } from '../core/sfx'
import type { LevelSimulation } from '../game/simulation'
import { SfPerf, type PerfSample } from '../ui/perf'

/**
 * dev 工具（?dev=1）：perf 叠加层、空格键暂停、无头一致性钩子。
 * 所有 dev 副作用集中于此模块，生产路径只保留可选实例的挂接点；
 * destroy() 对称清理全部副作用（监听器、叠加层、window 钩子），不残留。
 */
export class DevTools {
  /** 无头一致性钩子的全局键名（browser-consistency.ts 读取）。 */
  static readonly HOOK_KEY = '__sfgame'

  private perfEl: SfPerf
  private sim: LevelSimulation | null = null

  constructor() {
    this.perfEl = new SfPerf()
    document.body.appendChild(this.perfEl)
  }

  /** 绑定当前局（destroy 后可重新 attach）。 */
  attach(sim: LevelSimulation) {
    this.sim = sim
    window.addEventListener('keydown', this.onKeyDown)
    this.installHook()
  }

  /** 转发性能样本到叠加层（无 dev 时控制器不调用本方法）。 */
  record(sample: PerfSample) {
    this.perfEl.record(sample)
  }

  /** 暂停状态可能被非 dev 路径改变（如 restart 复位），向面板同步。 */
  syncPause() {
    if (this.sim) this.perfEl.paused = this.sim.paused
  }

  destroy() {
    this.sim = null
    window.removeEventListener('keydown', this.onKeyDown)
    this.perfEl.remove()
    // 删除全局钩子：防重复进入关卡后残留旧局引用（内存泄漏）
    delete (window as unknown as Record<string, unknown>)[DevTools.HOOK_KEY]
  }

  /** dev 空格：暂停/恢复物理时间；冻结时风声淡出。 */
  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.sim || e.code !== 'Space' || e.repeat) return
    e.preventDefault()
    this.sim.setPaused(!this.sim.paused)
    if (this.sim.paused) sfx.fadeOutWind()
    this.perfEl.paused = this.sim.paused
  }

  private installHook() {
    const sim = this.sim!
    ;(window as unknown as Record<string, unknown>)[DevTools.HOOK_KEY] = {
      hud: () => sim.hudState(),
      visitedCount: () => sim.visitedCount,
      paused: () => sim.paused,
    }
  }
}
