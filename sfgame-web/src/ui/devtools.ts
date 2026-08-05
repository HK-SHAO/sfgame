import { sfx } from '../core/sfx'
import type { LevelSimulation } from '../game/simulation'
import { SfPerf, type PerfSample } from '../ui/perf'
import { SfLevelEditor } from '../ui/level-editor'

/**
 * dev 工具（?dev=1）：性能叠加层（sf-perf，含拖拽手柄）+ 关卡 YAML 编辑器
 * （sf-level-editor，装配进 perf 的 slot 随面板移动）、空格键暂停。
 * 职责边界：perf 只显示性能与定位，编辑器只编辑关卡，本模块只做组装——
 * 各自独立、互不感知。destroy() 对称清理全部副作用（监听器、叠加层），不残留。
 */
export class DevTools {
  private perfEl: SfPerf
  private sim: LevelSimulation | null = null

  constructor() {
    this.perfEl = new SfPerf()
    // 编辑器装配进面板：随拖动/吸附，但拖动只认 perf 的 .head 手柄
    this.perfEl.appendChild(new SfLevelEditor())
    document.body.appendChild(this.perfEl)
  }

  /** 绑定当前局（destroy 后可重新 attach）。 */
  attach(sim: LevelSimulation) {
    this.sim = sim
    window.addEventListener('keydown', this.onKeyDown)
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
  }

  /** dev 空格：暂停/恢复物理时间；冻结时风声淡出。 */
  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.sim || e.code !== 'Space' || e.repeat) return
    e.preventDefault()
    this.sim.setPaused(!this.sim.paused)
    if (this.sim.paused) sfx.fadeOutWind()
    this.perfEl.paused = this.sim.paused
  }
}
