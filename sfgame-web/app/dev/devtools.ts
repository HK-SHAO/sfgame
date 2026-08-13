import { SfDevPanel } from './dev-panel.ts'
import { SfPerf, type PerfSample } from './perf.ts'
import { SfLevelEditor } from './level-editor.ts'

export interface PerfRecorder {
  record(sample: PerfSample): void
}

export interface DevToolsOptions {
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
