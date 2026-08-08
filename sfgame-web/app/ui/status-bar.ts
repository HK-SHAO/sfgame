import { LitElement, css, html, type PropertyValues } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { formatPenalty, formatTime } from '../game/timer'

// 声明式状态条：属性每帧由 sf-game 驱动（时间持续增长），shouldUpdate 内格式化比对短路，
// 文本未变零渲染成本（等价旧命令式 refresh 的字符串缓存）
@customElement('sf-status')
export class SfStatusBar extends LitElement {
  @property({ type: Number }) levelId = 0
  @property({ type: String }) levelName = ''
  @property({ type: Number }) time = 0
  @property({ type: Number }) penalty = 0

  private cached = { lv: '', name: '', t: '', p: '' }

  protected override shouldUpdate(changed: PropertyValues): boolean {
    const t = formatTime(this.time)
    const p = formatPenalty(this.penalty)
    const lv = this.levelId > 0 ? `第 ${this.levelId} 关` : ''
    const name = this.levelName
    if (
      !changed.has('levelId') &&
      !changed.has('levelName') &&
      t === this.cached.t &&
      p === this.cached.p
    ) {
      return false
    }
    this.cached = { lv, name, t, p }
    return true
  }

  protected override render() {
    return html`
      <span class="row">
        <span class="lv"><span class="no">${this.cached.lv}</span> ${this.cached.name}</span>
        <span class="t">用时 ${this.cached.t}</span>
        <span class="p">罚时 ${this.cached.p}</span>
      </span>
      <span class="ops">轻点放热源 · 长按放冷源 · 点按已放置的源可移除</span>
    `
  }

  static styles = css`
    :host {
      position: fixed;
      left: 50%;
      transform: translateX(-50%);
      /* iOS 26 横屏 home indicator 自动隐藏时 inset-bottom 突变归零：过渡平滑位移 */
      bottom: calc(var(--sp-4) + env(safe-area-inset-bottom, 0px));
      transition: bottom 180ms ease-out;
      z-index: 3;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--sp-2);
      width: max-content;
      max-width: min(94%, 36rem);
      padding: var(--sp-2) var(--page-pad-x);
      font-size: 0.875rem;
      color: var(--ink);
      font-variant-numeric: tabular-nums;
      text-align: center;
      background: rgba(255, 253, 248, 0.78);
      backdrop-filter: blur(1rem) saturate(1.5);
      -webkit-backdrop-filter: blur(1rem) saturate(1.5);
      border: 1px solid rgba(255, 255, 255, 0.6);
      border-radius: var(--r-lg);
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
      gap: var(--sp-4);
      font-weight: 600;
      white-space: nowrap;
    }

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
