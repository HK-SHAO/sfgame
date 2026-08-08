import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { version, author, description } from '../../package.json'
import { iconBack, iconDatabase, iconGear } from '../ui/icons'
import { artBg, boxReset, card, pageShell } from '../ui/shared-styles'

@customElement('sf-dev-menu')
export class SfDevMenu extends LitElement {
  @property({ attribute: false }) dev = false

  private onBack = () => this.dispatchEvent(new CustomEvent('back'))
  private openStorage = () => this.dispatchEvent(new CustomEvent('open-storage'))
  private onToggleDev = () => this.dispatchEvent(new CustomEvent('toggle-dev', { detail: !this.dev }))

  protected override render() {
    return html`
      <main class="page">
        <header class="bar">
          <div class="bar-inner">
            <button class="icon-btn" @click=${this.onBack} aria-label="返回">${iconBack}</button>
            <div class="head-text">
              <h1>开发者页面</h1>
            </div>
          </div>
        </header>

        <section class="card">
          <label class="row" aria-label="开发者模式">
            <span class="ico">${iconGear}</span>
            <span class="txt">
              <b>开发者模式</b>
              <small>${this.dev ? '已开启（开发面板/高速档/不限量道具）' : '已关闭'}</small>
            </span>
            <input type="checkbox" class="switch-input" .checked=${this.dev} @change=${this.onToggleDev} />
            <span class="switch" aria-hidden="true"><span class="knob"></span></span>
          </label>
          <button class="row" @click=${this.openStorage}>
            <span class="ico">${iconDatabase}</span>
            <span class="txt">
              <b>存储管理</b>
              <small>查看与清理本地持久化数据</small>
            </span>
          </button>
        </section>

        <section class="card about">
          <h2>关于</h2>
          <p class="line">${description}</p>
          <p class="line">作者：${author.name}</p>
          <p class="line">版本：v${version}</p>
        </section>
      </main>
    `
  }

  static styles = [
    boxReset,
    pageShell,
    artBg,
    card,
    css`
      :host {
        display: block;
        height: 100%;
        color: var(--ink);
      }

      .row {
        display: flex;
        align-items: center;
        gap: var(--sp-4);
        width: 100%;
        padding: var(--sp-4);
        /* 行含原生 button（存储管理）：须清零 UA buttonface 底色与黑边框 */
        border: none;
        background: none;
        border-radius: var(--r-md);
        corner-shape: squircle;
        color: inherit;
        cursor: pointer;
        text-align: left;
        font: inherit;
        -webkit-user-select: none;
        user-select: none;
        transition: background 120ms ease-out;
      }

      .row:hover {
        background: rgba(255, 255, 255, 0.55);
      }

      .row:active {
        transform: scale(0.985);
      }

      .ico {
        flex: none;
        width: var(--ctl-h);
        height: var(--ctl-h);
        display: grid;
        place-items: center;
        border-radius: var(--r-md);
        corner-shape: squircle;
        background: rgba(255, 237, 209, 0.85);
        color: var(--ink);
      }

      .ico svg {
        width: 1.25rem;
        height: 1.25rem;
      }

      .txt {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        min-width: 0;
        flex: 1;
      }

      .txt b {
        font-size: 0.9375rem;
        font-weight: 600;
      }

      .txt small {
        font-size: 0.75rem;
        color: var(--ink-soft);
      }

      /* 原生 checkbox 承载开关状态：视觉由 :checked + 相邻兄弟选择器驱动，键盘可聚焦 */
      .switch-input {
        position: absolute;
        opacity: 0;
        pointer-events: none;
      }

      .switch {
        flex: none;
        position: relative;
        width: 2.625rem;
        height: 1.5rem;
        border-radius: 999px;
        background: rgba(61, 52, 39, 0.14);
        transition: background 160ms ease-out;
      }

      .switch .knob {
        position: absolute;
        top: 0.19rem;
        left: 0.19rem;
        width: 1.12rem;
        height: 1.12rem;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 0.0625rem 0.25rem rgba(61, 52, 39, 0.25);
        transition: transform 160ms ease-out;
      }

      .switch-input:checked + .switch {
        background: var(--goal);
      }

      .switch-input:checked + .switch .knob {
        transform: translateX(1.12rem);
      }

      .switch-input:focus-visible + .switch {
        outline: 2px solid var(--cold);
        outline-offset: 2px;
      }

      .about {
        padding: var(--sp-4) 1.25rem;
      }

      .about h2 {
        margin: 0 0 0.5rem;
        font-size: 0.9375rem;
        font-weight: 700;
      }

      .about .line {
        margin: 0;
        font-size: 0.875rem;
        line-height: 1.8;
        color: var(--ink-soft);
      }
    `,
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-dev-menu': SfDevMenu
  }
}
