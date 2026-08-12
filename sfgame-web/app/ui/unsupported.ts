import { LitElement, css, html } from 'lit'
import { customElement } from 'lit/decorators.js'
import { boxReset, warmBg } from './shared-styles.ts'

// 终端页：WebAssembly 不可用时由 main.ts 挂载（无游戏可玩，不提供任何入口）
@customElement('sf-unsupported')
export class SfUnsupported extends LitElement {
  protected override render() {
    return html`
      <main class="page">
        <div class="card">
          <h1>此设备无法运行</h1>
          <p>物理模拟需要 WebAssembly</p>
          <p>(Chrome 57+、Safari 11+、Firefox 52+)</p>
          <p>请升级浏览器或更换设备后重试。</p>
        </div>
      </main>
    `
  }

  static styles = [
    boxReset,
    css`
      :host {
        display: block;
        height: 100svh;
        height: 100dvh;
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
      /* 居中 + 溢出兜底：margin auto 而非 place-items（溢出双向裁切） */
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
