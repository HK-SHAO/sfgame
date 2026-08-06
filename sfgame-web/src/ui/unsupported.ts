import { LitElement, css, html } from 'lit'
import { customElement } from 'lit/decorators.js'

// 终端页：WASM·SIMD 不可用时由 main.ts 挂载（无游戏可玩，不提供任何入口）
@customElement('sf-unsupported')
export class SfUnsupported extends LitElement {
  protected override render() {
    return html`
      <main class="page">
        <div class="card">
          <h1>此设备无法运行烧风</h1>
          <p>物理模拟需要 WebAssembly·SIMD（Chrome 91+、Safari 16.4+、Firefox 89+）。请升级浏览器或更换设备后重试。</p>
        </div>
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
      height: 100svh;
      height: 100dvh;
    }

    .page {
      height: 100%;
      display: flex;
      flex-direction: column;
      overflow: auto;
      padding: 1.5rem;
      background:
        radial-gradient(circle at 18% 12%, rgba(255, 196, 83, 0.32), transparent 42%),
        linear-gradient(180deg, #fff8ea 0%, #f8e6c4 100%);
    }

    .card {
      /* 居中 + 溢出兜底：margin auto 而非 place-items（溢出双向裁切） */
      margin: auto;
      max-width: 20rem;
      padding: 1.75rem 1.5rem;
      text-align: center;
      background: var(--card);
      border: 1px solid rgba(255, 255, 255, 0.6);
      border-radius: 1.75rem;
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
  `
}

export function mountUnsupported() {
  document.body.replaceChildren(document.createElement('sf-unsupported'))
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-unsupported': SfUnsupported
  }
}
