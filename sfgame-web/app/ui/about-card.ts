import { LitElement, css, html } from 'lit'
import { customElement } from 'lit/decorators.js'
import { author, description, version } from '../../package.json'
import { boxReset, card } from './shared-styles'

// 关于卡片：dev 页与独立关于页共用（信息单源，避免双处漂移）；
// 品牌组合图（透明 PNG 含 LOGO/标题/副标题）小号展示，内容左对齐
@customElement('sf-about-card')
export class SfAboutCard extends LitElement {
  protected override render() {
    return html`
      <section class="card about">
        <img
          class="brand"
          src="./logo-title.webp"
          alt="烧风 · 太阳精灵 · 用温度创造风"
          width="1254"
          height="1254"
        />
        <p class="line">${description}</p>
        <p class="line">作者：${author.name}</p>
        <p class="line">版本：v${version}</p>
      </section>
    `
  }

  static styles = [
    boxReset,
    card,
    css`
      :host {
        display: block;
      }

      .about {
        padding: var(--sp-4) 1.25rem;
      }

      .brand {
        display: block;
        width: 8rem;
        height: auto;
        margin: 0 auto 0.75rem;
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
    'sf-about-card': SfAboutCard
  }
}
