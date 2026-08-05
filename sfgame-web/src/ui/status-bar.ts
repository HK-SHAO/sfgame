import { LitElement, css, html } from 'lit'
import { customElement } from 'lit/decorators.js'
import { formatPenalty, formatTime } from '../game/timer'

/**
 * 底部常驻状态卡：关卡名（footer，样式与 header 标题一致）+ 实时"用时/罚时" + 操作说明。
 * 文本 1 位小数、0.1s 才变，refresh 文本不变即短路（零渲染开销）；
 * 过关覆盖层（z-index 5）盖住本组件（z-index 3）。
 */
@customElement('sf-status')
export class SfStatusBar extends LitElement {
  private t = ''
  private p = ''
  private lvNo = ''
  private lvName = ''

  /** 关卡名（第 N 关 + 名称），进入关卡时设置一次 */
  setLevel(id: number, name: string) {
    this.lvNo = `第 ${id} 关`
    this.lvName = name
    this.requestUpdate()
  }

  refresh(time: number, extra: number) {
    const t = formatTime(time)
    const p = formatPenalty(extra)
    if (t === this.t && p === this.p) return
    this.t = t
    this.p = p
    this.requestUpdate()
  }

  protected override render() {
    return html`
      <span class="row">
        <span class="lv"><span class="no">${this.lvNo}</span> ${this.lvName}</span>
        <span class="t">用时 ${this.t}</span>
        <span class="p">罚时 ${this.p}</span>
      </span>
      <span class="ops">轻点放热源 · 长按放冷源 · 点按已放置的源可移除</span>
    `
  }

  static styles = css`
    :host {
      position: fixed;
      left: 50%;
      transform: translateX(-50%);
      bottom: calc(0.875rem + env(safe-area-inset-bottom, 0px));
      z-index: 3;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.375rem;
      width: max-content;
      max-width: min(94%, 36rem);
      padding: 0.5rem 1.125rem;
      font-size: 0.875rem;
      color: var(--ink);
      font-variant-numeric: tabular-nums;
      text-align: center;
      background: rgba(255, 253, 248, 0.78);
      backdrop-filter: blur(1rem) saturate(1.5);
      -webkit-backdrop-filter: blur(1rem) saturate(1.5);
      border: 1px solid rgba(255, 255, 255, 0.6);
      border-radius: 1rem;
      corner-shape: squircle;
      box-shadow: 0 0.25rem 1.125rem rgba(61, 52, 39, 0.1);
      pointer-events: none;
    }

    /* 显式声明：:host 的 display 会覆盖 UA 的 [hidden] 规则 */
    :host([hidden]) {
      display: none;
    }

    .ops {
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--ink-soft);
    }

    .row {
      display: flex;
      align-items: baseline;
      gap: 0.875rem;
      font-weight: 600;
      white-space: nowrap;
    }

    /* 关卡名：与 header 标题同款视觉（no 淡化 + 名称加粗） */
    .lv {
      font-size: 0.875rem;
      font-weight: 600;
      letter-spacing: 0.01em;
    }

    .lv .no {
      color: var(--ink-soft);
      font-weight: 500;
      font-size: 0.75rem;
      margin-right: 0.125rem;
    }

    .t {
      font-size: 0.875rem;
    }

    .p {
      color: var(--ink-soft);
      font-weight: 500;
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-status': SfStatusBar
  }
}
