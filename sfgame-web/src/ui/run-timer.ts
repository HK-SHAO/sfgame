import { LitElement, css, html } from 'lit'
import { customElement } from 'lit/decorators.js'
import { formatPenalty, formatTime } from '../game/timer'

/**
 * 底部常驻计时条：实时显示"模拟耗时 + 罚时"。
 * 性能设计：controller 每帧调用 refresh()（读 sim 计时，纯函数零事件）；
 * 显示文本 1 位小数、每 0.1s 才变一次——文本不变时直接短路，零渲染开销。
 * 过关覆盖层（z-index 5）盖住本组件（z-index 3），结算由 win-card 展示。
 */
@customElement('sf-run-timer')
export class SfRunTimer extends LitElement {
  private t = ''
  private p = ''

  /** 每帧调用（模拟推进时）。文本未变化时零开销。 */
  refresh(time: number, extra: number) {
    const t = formatTime(time)
    const p = formatPenalty(extra)
    if (t === this.t && p === this.p) return
    this.t = t
    this.p = p
    this.requestUpdate()
  }

  protected override render() {
    return html`<span class="t">用时 ${this.t}</span><span class="p">罚时 ${this.p}</span>`
  }

  static styles = css`
    :host {
      position: fixed;
      left: 50%;
      transform: translateX(-50%);
      /* 与底部文案（新手提示）同一位置（底部中央边缘）：无道具时文案显示、
         本组件隐藏，放置道具后互换——两 UI 交替出现保持一致性 */
      bottom: calc(0.875rem + env(safe-area-inset-bottom, 0px));
      z-index: 3;
      display: flex;
      align-items: baseline;
      gap: 0.875rem;
      width: max-content;
      max-width: min(94%, 36rem);
      padding: 0.5rem 1.125rem;
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--ink);
      font-variant-numeric: tabular-nums;
      background: rgba(255, 253, 248, 0.78);
      backdrop-filter: blur(1rem) saturate(1.5);
      -webkit-backdrop-filter: blur(1rem) saturate(1.5);
      border: 1px solid rgba(255, 255, 255, 0.6);
      border-radius: 1rem;
      corner-shape: squircle;
      box-shadow: 0 0.25rem 1.125rem rgba(61, 52, 39, 0.1);
      pointer-events: none;
      white-space: nowrap;
    }

    /* 显式声明：:host 的 display 会覆盖 UA 的 [hidden] 规则 */
    :host([hidden]) {
      display: none;
    }

    .p {
      color: var(--ink-soft);
      font-weight: 500;
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-run-timer': SfRunTimer
  }
}
