import { LitElement, css, html, type PropertyValues } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { formatPenalty, formatTime } from '../game/timer.ts'
import { boxReset } from './shared-styles.ts'

@customElement('sf-status')
export class SfStatusBar extends LitElement {
  @property({ type: Number }) levelNo = 0
  @property({ type: String }) levelName = ''
  @property({ type: Number }) time = 0
  @property({ type: Number }) penalty = 0

  private cached = { lv: '', name: '', t: '', p: '' }

  protected override shouldUpdate(changed: PropertyValues): boolean {
    const t = formatTime(this.time)
    const p = formatPenalty(this.penalty)
    const lv = this.levelNo > 0 ? `第 ${String(this.levelNo).padStart(2, '0')} 关` : ''
    const name = this.levelName
    if (
      !changed.has('levelNo') &&
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
    `
  }

  static styles = [
    boxReset,
    css`
    :host {
      text-autospace: normal;
      position: fixed;
      left: 50%;
      transform: translateX(-50%);
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
      backdrop-filter: var(--blur-glass);
      -webkit-backdrop-filter: var(--blur-glass);
      border: 1px solid var(--glass-line);
      border-radius: var(--r-lg);
      corner-shape: squircle;
      box-shadow: var(--shadow-card);
      pointer-events: none;
    }

    :host([hidden]) {
      display: none;
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
      margin-right: var(--sp-0-5);
    }

    .t {
      font-size: 0.875rem;
    }

    .p {
      color: var(--ink-soft);
      font-weight: 500;
    }
  `,
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-status': SfStatusBar
  }
}
