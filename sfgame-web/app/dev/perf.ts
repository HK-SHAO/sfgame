import { LitElement, css, html } from 'lit'
import { customElement } from 'lit/decorators.js'
import { author, version } from '../../package.json'

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
  private fps = 'sampling…'
  private p95 = '—'
  private max = '—'
  private tick = '—'
  private batch = '—'
  private load = '—'
  private verts = '—'
  private up = '—'
  private tracers = '—'
  private dpr = '—'

  static styles = css`
    :host {
      display: block;
      color-scheme: light;
    }

    .lines {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.0625rem var(--sp-3);
      padding: var(--sp-1) var(--sp-2);
      user-select: all;
    }

    .cell {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--sp-1);
      min-width: 0;
      font-size: 0.6875rem;
      line-height: 1.5;
    }

    .cell .k {
      opacity: 0.55;
      white-space: nowrap;
    }

    .cell .v {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .divider {
      height: 1px;
      margin: var(--sp-1) 0 0.0625rem;
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

  private cell(k: string, v: string) {
    return html`<div class="cell"><span class="k">${k}</span><span class="v">${v}</span></div>`
  }

  protected override render() {
    return html`
      <div class="lines">
        ${this.cell('fps', this.fps)}
        ${this.cell('p95', this.p95)}
        ${this.cell('max', this.max)}
        ${this.cell('tick', this.tick)}
        ${this.cell('batch', this.batch)}
        ${this.cell('load', this.load)}
        ${this.cell('verts', this.verts)}
        ${this.cell('up', this.up)}
        ${this.cell('tracers', this.tracers)}
        ${this.cell('dpr', this.dpr)}
        ${this.cell('author', author.name)}
        ${this.cell('version', version)}
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
    this.fps = mean > 0 ? (1000 / mean).toFixed(0) : '—'
    this.p95 = `${p(0.95)}ms`
    this.max = `${sorted[sorted.length - 1].toFixed(1)}ms`
    let tickSum = 0
    let batchSum = 0
    for (const s of this.samples) {
      tickSum += s.tick
      batchSum += s.batch
    }
    const tickAvg = tickSum / n
    const batchAvg = batchSum / n
    this.tick = `${tickAvg.toFixed(2)}ms`
    this.batch = `${batchAvg.toFixed(2)}ms`
    this.load = `${Math.round(((tickAvg + batchAvg) / FRAME_BUDGET_MS) * 100)}%`
    const last = this.last
    this.verts = last ? String(last.vertices) : '—'
    this.up = last ? `${(last.uploadBytes / 1024 / 1024).toFixed(2)}MB` : '—'
    this.tracers = last ? String(last.tracers) : '—'
    this.dpr = last ? last.dpr.toFixed(1) : '—'
    this.requestUpdate()
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-perf': SfPerf
  }
}
