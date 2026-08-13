import { LitElement, css, html, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SOURCE_PENALTY, formatTime } from '../game/timer.ts'
import { boxReset, buttonReset } from './shared-styles.ts'

@customElement('sf-win-overlay')
export class SfWinOverlay extends LitElement {
  @property({ attribute: false }) title = ''
  @property({ attribute: false }) text = ''
  @property({ attribute: false }) time = 0
  @property({ attribute: false }) extra = 0
  @property({ attribute: false }) sources = 0
  @property({ attribute: false }) bestTotal: number | undefined = undefined
  @property({ attribute: false }) rank = -1
  @property({ attribute: false }) hasNext = false

  private onMain = () =>
    this.dispatchEvent(new CustomEvent(this.hasNext ? 'next' : 'replay'))
  private onReplay = () => this.dispatchEvent(new CustomEvent('replay'))
  private onBack = () => this.dispatchEvent(new CustomEvent('back'))

  protected override render() {
    const groundPenalty = this.extra - this.sources * SOURCE_PENALTY
    const extraBreakdown =
      this.extra > 0
        ? groundPenalty > 0
          ? `道具 +${this.sources * SOURCE_PENALTY}s · 贴地 +${groundPenalty.toFixed(1)}s`
          : `道具 +${this.sources * SOURCE_PENALTY}s`
        : ''
    return html`
      <div class="overlay" role="dialog" aria-label="过关">
        <div class="win-card">
          <h2>${this.title}</h2>
          <p class="desc">${this.text}</p>
          <p class="stats">
            <b class="total">合计 ${formatTime(this.time + this.extra)}</b>
            ${this.bestTotal !== undefined
              ? html`<span class="line record"
                  >本关最佳 ${formatTime(this.bestTotal)}${this.rank === 0 ? ' · 新纪录' : ''}</span
                >`
              : nothing}
            <span class="line">用时 ${formatTime(this.time)}</span>
            ${extraBreakdown ? html`<span class="note">${extraBreakdown}</span>` : nothing}
          </p>
          <div class="actions">
            <button class="primary next" @click=${this.onMain}>
              ${this.hasNext ? '下一关' : '再玩一次'}
            </button>
            <div class="row">
              ${this.hasNext ? html`<button class="ghost" @click=${this.onReplay}>再玩一次</button>` : nothing}
              <button class="ghost" @click=${this.onBack}>选关</button>
            </div>
          </div>
        </div>
      </div>
    `
  }

  static styles = [
    boxReset,
    buttonReset,
    css`
      .overlay {
      position: absolute;
      inset: 0;
      z-index: 5;
      display: flex;
      flex-direction: column;
      padding: calc(var(--page-pad-y) + env(safe-area-inset-top, 0px))
        calc(var(--page-pad-x) + env(safe-area-inset-right, 0px))
        calc(var(--page-pad-y) + env(safe-area-inset-bottom, 0px))
        calc(var(--page-pad-x) + env(safe-area-inset-left, 0px));
      background: var(--scrim);
      animation: fade 260ms ease-out;
    }

    .win-card {
      width: 100%;
      max-width: var(--maxw-dialog);
      margin: auto;
      padding: var(--card-pad);
      text-align: center;
      background: var(--card);
      backdrop-filter: var(--blur-glass);
      -webkit-backdrop-filter: var(--blur-glass);
      border: 1px solid rgba(255, 255, 255, 0.7);
      border-radius: var(--r-xl);
      corner-shape: squircle;
      box-shadow: 0 1.5rem 3.75rem rgba(61, 52, 39, 0.22);
      animation: pop 340ms cubic-bezier(0.3, 1.35, 0.5, 1);
    }

    h2 {
      margin: 0 0 0.5rem;
      font-size: 1.625rem;
      font-weight: 700;
      letter-spacing: -0.01em;
    }

    .desc {
      margin: 0 0 var(--sp-5-5);
      font-size: 0.875rem;
      line-height: 1.7;
      color: var(--ink-soft);
    }

    .stats {
      margin: 0 0 var(--sp-5-5);
      padding: var(--sp-4);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--sp-2);
      font-variant-numeric: tabular-nums;
      color: var(--ink);
      background: var(--card-warm);
      border: 1px solid rgba(255, 255, 255, 0.55);
      border-radius: var(--r-lg);
      corner-shape: squircle;
    }

    .stats .total {
      font-size: 1.375rem;
      font-weight: 700;
      letter-spacing: 0.01em;
    }

    .stats .line {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--ink-soft);
      white-space: nowrap;
    }

    .stats .note {
      font-size: 0.75rem;
      color: var(--ink-soft);
      opacity: 0.75;
      white-space: nowrap;
    }

    .stats .record {
      color: var(--goal);
      font-weight: 600;
    }

    .actions {
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
      width: 100%;
      max-width: var(--maxw-actions);
      margin: 0 auto;
    }

    .actions .next {
      width: 100%;
    }

    .row {
      display: flex;
      gap: var(--sp-2-5);
      justify-content: center;
    }

    .row button {
      flex: 1;
    }

    button {
      padding: var(--ctl-pad);
      font-size: 0.875rem;
      font-weight: 600;
      border-radius: var(--r-lg);
      corner-shape: squircle;
      cursor: pointer;
      color: inherit;
      transition: transform 100ms ease-out, background 120ms ease-out;
    }

    button:active {
      transform: scale(0.97);
    }

    .primary {
      background: linear-gradient(180deg, #ff7a52, #ff5a3c);
      color: #fff;
      box-shadow: 0 6px 16px rgba(255, 90, 60, 0.35);
    }

    .primary:hover {
      background: linear-gradient(180deg, #ff8a64, #ff6a4e);
    }

    .ghost {
      background: var(--ink-wash);
      color: var(--ink);
    }

    @keyframes pop {
      from {
        opacity: 0;
        transform: scale(0.88);
      }
      to {
        opacity: 1;
        transform: scale(1);
      }
    }

    @keyframes fade {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
  `,
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-win-overlay': SfWinOverlay
  }
}
