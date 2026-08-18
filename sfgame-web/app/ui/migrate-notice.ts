import { LitElement, css, html } from 'lit'
import { customElement } from 'lit/decorators.js'
import { boxReset, buttonReset } from './shared-styles.ts'

const TOY_URL = 'https://www.bilibili.com/toy/sf/index.html'

@customElement('sf-migrate')
export class SfMigrate extends LitElement {
  protected override render() {
    return html`
      <div class="overlay" role="dialog" aria-label="游戏迁移提示">
        <div class="card">
          <h1>烧风搬家啦</h1>
          <p>
            新版本已登陆哔哩哔哩「小玩具」平台：排行榜、云存档等功能上线，此版本将停止更新。
          </p>
          <a class="go" href=${TOY_URL}>前往新版本</a>
          <button class="stay" @click=${this.dismiss}>暂不前往，继续当前版本</button>
        </div>
      </div>
    `
  }

  private dismiss() {
    this.remove()
  }

  static styles = [
    boxReset,
    buttonReset,
    css`
      :host {
        position: fixed;
        inset: 0;
        z-index: 100;
        display: block;
      }

      .overlay {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        padding: calc(var(--page-pad-y) + env(safe-area-inset-top, 0px))
          calc(var(--page-pad-x) + env(safe-area-inset-right, 0px))
          calc(var(--page-pad-y) + env(safe-area-inset-bottom, 0px))
          calc(var(--page-pad-x) + env(safe-area-inset-left, 0px));
        background: var(--bg-warm);
        animation: fade 260ms ease-out;
      }

      .card {
        width: 100%;
        max-width: 24rem;
        margin: auto;
        padding: var(--card-pad);
        text-align: center;
        background: var(--card);
        backdrop-filter: var(--blur-glass);
        -webkit-backdrop-filter: var(--blur-glass);
        border: 1px solid rgba(255, 255, 255, 0.7);
        border-radius: var(--r-xl);
        corner-shape: squircle;
        box-shadow: var(--shadow-overlay);
        animation: pop 340ms cubic-bezier(0.3, 1.35, 0.5, 1);
      }

      h1 {
        margin: 0 0 var(--sp-3);
        font-size: 1.625rem;
        font-weight: 700;
        letter-spacing: -0.01em;
      }

      p {
        margin: 0 0 var(--sp-5);
        font-size: 0.9375rem;
        line-height: 1.8;
        color: var(--ink-soft);
      }

      .go {
        display: block;
        padding: var(--ctl-pad);
        font-size: 1rem;
        font-weight: 700;
        text-align: center;
        text-decoration: none;
        color: #fff;
        background: linear-gradient(180deg, #ff7a52, #ff5a3c);
        border-radius: var(--r-lg);
        corner-shape: squircle;
        box-shadow: 0 6px 16px rgba(255, 90, 60, 0.35);
        transition: transform 100ms ease-out, background 120ms ease-out;
      }

      .go:hover {
        background: linear-gradient(180deg, #ff8a64, #ff6a4e);
      }

      .go:active {
        transform: scale(0.97);
      }

      .stay {
        margin-top: var(--sp-3);
        padding: var(--sp-2) var(--sp-4);
        font-size: 0.8125rem;
        font-weight: 500;
        color: var(--ink-soft);
        border-radius: var(--r-pill);
      }

      .stay:hover {
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
    'sf-migrate': SfMigrate
  }
}
