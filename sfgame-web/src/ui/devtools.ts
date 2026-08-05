import { SfDevPanel } from '../ui/dev-panel'
import { SfPerf, type PerfSample } from '../ui/perf'
import { SfLevelEditor } from '../ui/level-editor'

/**
 * dev 工具（?dev=1）：开发面板（sf-dev-panel，外壳：定位/拖拽/主题/滚动）
 * + 性能块（sf-perf）+ 关卡 YAML 编辑器（sf-level-editor），三者独立互不感知，
 * 本模块只做组装。destroy() 对称清理全部副作用，不残留。
 */
export class DevTools {
  private panel: SfDevPanel
  private perfEl: SfPerf

  constructor() {
    this.panel = new SfDevPanel()
    this.perfEl = new SfPerf()
    // 装配：性能块 + 编辑器，随面板拖动/吸附；拖动只认面板 .head 手柄
    this.panel.append(this.perfEl, new SfLevelEditor())
    document.body.appendChild(this.panel)
  }

  /** 转发性能样本到性能块（无 dev 时控制器不调用本方法）。 */
  record(sample: PerfSample) {
    this.perfEl.record(sample)
  }

  /** 暂停状态可能被非 dev 路径改变（如 restart 复位/HUD 按钮），向性能块同步。 */
  syncPause(paused: boolean) {
    this.perfEl.paused = paused
  }

  destroy() {
    this.panel.remove()
  }
}
