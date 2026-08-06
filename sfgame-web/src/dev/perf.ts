import { LitElement, css, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'

export interface PerfSample {
  tickMs: number
  batchMs: number
  vertices: number
  uploadBytes: number
  tracers: number
  dpr: number
}

const WINDOW = 90
const THROTTLE_MS = 1000 / 24
// load% 的分母：60fps 单帧预算
const FRAME_BUDGET_MS = 1000 / 60

interface FrameSample {
  interval: number
  tick: number
  batch: number
}

@customElement('sf-perf')
export class SfPerf extends LitElement {
  private samples: FrameSample[] = []
  private lastAt = 0
  private lastRefresh = 0
  private last: PerfSample | null = null
  private line1 = 'sampling…'
  private line2 = ''
  private line3 = ''
  @state() paused = false

  static styles = css`
    :host {
      display: block;
    }

    .lines {
      display: flex;
      flex-direction: column;
      gap: 0.0625rem;
      padding: 0.125rem 0.375rem;
      font-size: 0.6875rem;
      line-height: 1.5;
      user-select: none;
    }

    .divider {
      height: 1px;
      margin: 0.25rem 0 0.0625rem;
      background: var(--dev-hairline);
    }
  `

  record(sample: PerfSample) {
    this.last = sample
    const now = performance.now()
    if (this.lastAt > 0) {
      this.samples.push({
        interval: now - this.lastAt,
        tick: sample.tickMs,
        batch: sample.batchMs,
      })
      if (this.samples.length > WINDOW) this.samples.shift()
    }
    this.lastAt = now
    if (now - this.lastRefresh >= THROTTLE_MS && this.samples.length > 0) this.refresh(now)
  }

  protected override render() {
    return html`
      <div class="lines">
        <div>${this.line1}</div>
        <div>${this.line2}</div>
        <div>${this.line3}</div>
      </div>
      <div class="divider"></div>
    `
  }

  private refresh(now: number) {
    this.lastRefresh = now
    const n = this.samples.length
    const sorted = this.samples.map((s) => s.interval).sort((a, b) => a - b)
    const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))].toFixed(1)
    const mean = sorted.reduce((s, v) => s + v, 0) / n
    const fps = mean > 0 ? (1000 / mean).toFixed(0) : '—'
    const max = sorted[sorted.length - 1].toFixed(1)
    let tickSum = 0
    let batchSum = 0
    for (const s of this.samples) {
      tickSum += s.tick
      batchSum += s.batch
    }
    const tickAvg = tickSum / n
    const batchAvg = batchSum / n
    const load = Math.round(((tickAvg + batchAvg) / FRAME_BUDGET_MS) * 100)
    const last = this.last
    const mb = last ? (last.uploadBytes / 1024 / 1024).toFixed(2) : '—'
    const pauseMark = this.paused ? ' · paused' : ''
    this.line1 = `${fps} fps · p95 ${p(0.95)}ms · max ${max}ms`
    this.line2 = `tick ${tickAvg.toFixed(2)}ms · batch ${batchAvg.toFixed(2)}ms · load ${load}%`
    this.line3 = `verts ${last ? last.vertices : '—'} · up ${mb}MB · tracers ${last ? last.tracers : '—'} · dpr ${
      last ? last.dpr.toFixed(1) : '—'
    }${pauseMark}`
    this.requestUpdate()
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-perf': SfPerf
  }
}
