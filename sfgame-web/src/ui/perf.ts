import { LitElement, css, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'

/**
 * dev 性能块（?dev=1）：两行性能显示（非等宽省宽），独立组件、无定位/拖动——
 * 由 DevTools 装配进开发面板（sf-dev-panel）的 slot。主题色复用面板 --dev-* 变量。
 * 轻量原则：每帧只做加法与 push；文本每 WINDOW 帧才更新一次。
 */
export interface PerfSample {
  tickMs: number
  batchMs: number
  vertices: number
  uploadBytes: number
  /** 游戏循环 rAF 帧数 / 实际渲染数 */
  loopFrames: number
  loopRenders: number
}

/** 统计窗口（帧数）：约 1.5 秒一个窗口 */
const WINDOW = 90

@customElement('sf-perf')
export class SfPerf extends LitElement {
  private intervals: number[] = []
  private frames = 0
  private lastAt = 0
  private tickSum = 0
  private batchSum = 0
  private last: PerfSample | null = null
  private line1 = 'perf 采集中…'
  private line2 = ''
  /** 物理暂停状态（dev 空格）：显示在第二行（外部直接赋值，@state 即时生效） */
  @state() paused = false

  static styles = css`
    :host {
      display: block;
    }

    .lines {
      display: flex;
      flex-direction: column;
      gap: 0.0625rem;
      /* 与 .head / 编辑器控件一致的内边距 */
      padding: 0.125rem 0.375rem;
      font-size: 0.6875rem;
      line-height: 1.5;
      user-select: none;
    }

    /* 与下方装配块的 分割线 */
    .divider {
      height: 1px;
      margin: 0.25rem 0 0.0625rem;
      background: var(--dev-hairline);
    }
  `

  /** 每帧调用：只做加法，满窗口后刷新显示 */
  record(sample: PerfSample) {
    this.last = sample
    const now = performance.now()
    if (this.lastAt > 0) this.intervals.push(now - this.lastAt)
    this.lastAt = now
    this.tickSum += sample.tickMs
    this.batchSum += sample.batchMs
    if (++this.frames >= WINDOW) this.refresh()
  }

  protected override render() {
    return html`
      <div class="lines">
        <div>${this.line1}</div>
        <div>${this.line2}</div>
      </div>
      <div class="divider"></div>
    `
  }

  private refresh() {
    const n = this.frames
    const sorted = [...this.intervals].sort((a, b) => a - b)
    const p = (q: number) => {
      const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q))
      return idx < 0 ? '—' : sorted[idx].toFixed(1)
    }
    const mean = sorted.length > 0 ? sorted.reduce((s, v) => s + v, 0) / sorted.length : 0
    const fps = mean > 0 ? (1000 / mean).toFixed(0) : '—'
    const last = this.last
    const mb = last ? (last.uploadBytes / 1024 / 1024).toFixed(2) : '—'
    const pauseMark = this.paused ? ' · ⏸ 已暂停（空格恢复）' : ''
    // 两行排布（非等宽字体，行宽最小化）：帧率/延迟一行，顶点/内存/暂停一行
    this.line1 = `${fps} fps · p95 ${p(0.95)}ms · tick ${(this.tickSum / n).toFixed(2)}ms · batch ${(this.batchSum / n).toFixed(2)}ms`
    this.line2 = `顶点 ${last ? last.vertices : '—'} · 上传 ${mb}MB${pauseMark}`
    this.requestUpdate()
    this.intervals.length = 0
    this.frames = 0
    this.tickSum = 0
    this.batchSum = 0
    this.lastAt = 0
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-perf': SfPerf
  }
}
