import { SfDevPanel } from './dev-panel'
import { SfPerf, type PerfSample } from './perf'
import { SfLevelEditor } from './level-editor'

export class DevTools {
  private panel: SfDevPanel
  private perfEl: SfPerf

  constructor() {
    this.panel = new SfDevPanel()
    this.perfEl = new SfPerf()
    this.panel.append(this.perfEl, new SfLevelEditor())
    document.body.appendChild(this.panel)
  }

  record(sample: PerfSample) {
    this.perfEl.record(sample)
  }

  syncPause(paused: boolean) {
    this.perfEl.paused = paused
  }

  destroy() {
    this.panel.remove()
  }
}
