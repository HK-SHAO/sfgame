import { SfDevPanel } from './dev-panel'
import { SfPerf, type PerfSample } from './perf'
import { SfLevelEditor } from './level-editor'

// controller/sf-game 依赖的性能记录面：dev 面板的独立实现，游戏循环不依赖 dev 具体类
export interface PerfRecorder {
  record(sample: PerfSample): void
}

export interface DevToolsOptions {
  // 关卡编辑器「生效」回调：内联关卡 JSON 由 app 压 URL（读在编辑器、写收敛到 app）
  onApply: (json: string) => void
}

export class DevTools implements PerfRecorder {
  private panel: SfDevPanel
  private perfEl: SfPerf

  constructor(opts: DevToolsOptions) {
    this.panel = new SfDevPanel()
    this.perfEl = new SfPerf()
    const editor = new SfLevelEditor()
    editor.onApply = opts.onApply
    this.panel.append(this.perfEl, editor)
  }

  // 挂入 hud 的 shadow 内（top 锚 hud 底，天然不与 header 重合）；hud 重建后由 app 重挂。
  // 已挂载即跳过：重复 appendChild 触发子树重挂，会清空其中 textarea 的原生撤销栈与滚动位置
  mount(host: HTMLElement) {
    const root = host.shadowRoot
    if (root && this.panel.parentNode !== root) root.appendChild(this.panel)
  }

  record(sample: PerfSample) {
    this.perfEl.record(sample)
  }

  destroy() {
    this.panel.remove()
  }
}
