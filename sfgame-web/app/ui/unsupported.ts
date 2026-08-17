import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { boxReset, warmBg } from './shared-styles.ts'

export type UnsupportedReason = 'wasm' | 'webgl' | 'fatal'

const MESSAGES: Record<UnsupportedReason, readonly string[]> = {
  wasm: [
    '此设备无法运行',
    '物理模拟需要 WebAssembly',
    '(Chrome 57+、Safari 11+、Firefox 52+)',
    '请升级浏览器或更换设备后重试。',
  ],
  webgl: [
    '此设备无法运行',
    '画面渲染需要 WebGL',
    '(Chrome 9+、Safari 8+、Firefox 4+)',
    '请升级浏览器或更换设备后重试。',
  ],
  fatal: ['游戏启动失败', '模拟引擎运行出错', '请刷新页面重试。'],
}

const UNKNOWN: readonly string[] = [
  '游戏无法运行',
  '出现未知错误',
  '请刷新页面重试，或升级浏览器到最新版。',
]

@customElement('sf-unsupported')
export class SfUnsupported extends LitElement {
  @property() reason: UnsupportedReason = 'wasm'

  protected override render() {
    const [title, ...lines] = MESSAGES[this.reason] ?? UNKNOWN
    return html`
      <main class="page">
        <div class="card">
          <h1>${title}</h1>
          ${lines.map((l) => html`<p>${l}</p>`)}
        </div>
      </main>
    `
  }

  static styles = [
    boxReset,
    css`
      :host {
        display: block;
        height: 100%;
      }

      .page {
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: auto;
        padding: var(--page-pad-y) var(--page-pad-x);
        ${warmBg}
      }

      .card {
        margin: auto;
        padding: var(--card-pad);
        text-align: center;
        background: var(--card);
        border: 1px solid rgba(255, 255, 255, 0.6);
        border-radius: var(--r-xl);
        corner-shape: squircle;
        box-shadow: 0 1.125rem 2.75rem rgba(61, 52, 39, 0.1);
      }

      h1 {
        margin: 0 0 0.5rem;
        font-size: 1.25rem;
        font-weight: 700;
      }

      p {
        margin: 0;
        font-size: 0.875rem;
        line-height: 1.7;
        color: var(--ink-soft);
      }
    `,
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-unsupported': SfUnsupported
  }
}
