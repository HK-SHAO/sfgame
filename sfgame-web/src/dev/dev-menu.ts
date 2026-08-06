import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { version, author, description } from '../../package.json'
import { iconBack, iconChip, iconDatabase, iconGear, iconRoute } from '../ui/icons'
import { urlState } from '../game/state'
import { activeBackend, backendPref, resolvedBackend, wasmReady } from '../sim/wasm-fluid'

@customElement('sf-dev-menu')
export class SfDevMenu extends LitElement {
  @property({ attribute: false }) dev = false

  private onBack = () => this.dispatchEvent(new CustomEvent('back'))
  private openSolutions = () => this.dispatchEvent(new CustomEvent('open-solutions'))
  private openStorage = () => this.dispatchEvent(new CustomEvent('open-storage'))
  private onToggleDev = () => this.dispatchEvent(new CustomEvent('toggle-dev', { detail: !this.dev }))

  // 开关语义：ON = WASM 生效；WASM 不可用时置灰禁用（切过去也无意义）
  private get wasmOn(): boolean {
    return resolvedBackend() === 'wasm'
  }

  private get wasmUnavailable(): boolean {
    return !wasmReady() && backendPref() !== 'js'
  }

  private get backendDesc(): string {
    if (this.wasmOn) return activeBackend() === 'wasm' ? 'WASM·SIMD（加速物理内核）' : 'WASM·SIMD（已加载）'
    return this.wasmUnavailable ? 'JS（当前设备不支持 WASM·SIMD）' : 'JS（关闭加速）'
  }

  // 与开发者模式开关同款 replaceState 写入；后端在模拟构造时定型，重载生效
  private onToggleBackend = () => {
    if (this.wasmOn) urlState.set('be', 'js', { replace: true })
    else urlState.clear('be', { replace: true })
    setTimeout(() => window.location.reload(), 0)
  }

  protected override render() {
    return html`
      <main class="page">
        <header class="head">
          <button class="icon-btn" @click=${this.onBack} aria-label="返回">${iconBack}</button>
          <div class="head-text">
            <h1>开发者页面</h1>
          </div>
        </header>

        <section class="card">
          <button class="row" @click=${this.onToggleDev}>
            <span class="ico">${iconGear}</span>
            <span class="txt">
              <b>开发者模式</b>
              <small>${this.dev ? '已开启（开发面板/高速档/不限量道具）' : '已关闭'}</small>
            </span>
            <span class="switch ${this.dev ? 'on' : ''}" aria-hidden="true"><span class="knob"></span></span>
          </button>
          <button class="row" @click=${this.onToggleBackend} ?disabled=${this.wasmUnavailable}>
            <span class="ico">${iconChip}</span>
            <span class="txt">
              <b>物理后端</b>
              <small>${this.backendDesc}</small>
            </span>
            <span
              class="switch ${this.wasmOn ? 'on' : ''}${this.wasmUnavailable ? ' disabled' : ''}"
              aria-hidden="true"
              ><span class="knob"></span
            ></span>
          </button>
          <button class="row" @click=${this.openSolutions}>
            <span class="ico">${iconRoute}</span>
            <span class="txt">
              <b>解法参考</b>
              <small>各关参考解链接</small>
            </span>
          </button>
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
          <p class="line">作者：${author}</p>
          <p class="line">版本：v${version}</p>
        </section>
      </main>
    `
  }

  static styles = css`
    /* shadow DOM 不继承全局 box-sizing */
    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }

    :host {
      display: block;
      height: 100%;
      color: var(--ink);
    }

    .page {
      height: 100%;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding:
        calc(0.875rem + env(safe-area-inset-top, 0px)) 1.125rem
        calc(1.875rem + env(safe-area-inset-bottom, 0px));
      background:
        radial-gradient(circle at 84% 10%, rgba(255, 196, 83, 0.22), transparent 42%),
        linear-gradient(180deg, #fff8ea 0%, #f8e6c4 100%);
    }

    .head {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      max-width: 35rem;
      margin: 0 auto 1.25rem;
    }

    .icon-btn {
      flex: none;
      width: 2.5rem;
      height: 2.5rem;
      display: grid;
      place-items: center;
      border: none;
      border-radius: 0.75rem;
      corner-shape: squircle;
      background: rgba(255, 253, 248, 0.66);
      backdrop-filter: blur(1rem) saturate(1.5);
      -webkit-backdrop-filter: blur(1rem) saturate(1.5);
      border: 1px solid rgba(255, 255, 255, 0.55);
      box-shadow: 0 0.125rem 0.625rem rgba(61, 52, 39, 0.06);
      color: var(--ink);
      cursor: pointer;
      padding: 0;
    }

    .icon-btn:active {
      transform: scale(0.97);
    }

    .icon-btn svg {
      width: 1.19rem;
      height: 1.19rem;
    }

    .head-text h1 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 700;
      letter-spacing: 0.01em;
    }

    .card {
      max-width: 35rem;
      margin: 0 auto 1.25rem;
      padding: 0.375rem;
      background: var(--card);
      border: 1px solid rgba(255, 255, 255, 0.6);
      border-radius: 1rem;
      corner-shape: squircle;
      box-shadow: 0 0.5rem 1.375rem rgba(61, 52, 39, 0.07);
    }

    .row {
      display: flex;
      align-items: center;
      gap: 0.875rem;
      width: 100%;
      padding: 0.875rem 1rem;
      border: none;
      border-radius: 0.75rem;
      corner-shape: squircle;
      background: none;
      color: inherit;
      text-decoration: none;
      cursor: pointer;
      text-align: left;
      font: inherit;
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
      width: 2.5rem;
      height: 2.5rem;
      display: grid;
      place-items: center;
      border-radius: 0.75rem;
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

    .switch.on {
      background: var(--goal);
    }

    .switch.on .knob {
      transform: translateX(1.12rem);
    }

    .switch.disabled {
      opacity: 0.45;
    }

    .row:disabled {
      cursor: default;
    }

    .about {
      padding: 1rem 1.25rem;
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
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-dev-menu': SfDevMenu
  }
}
