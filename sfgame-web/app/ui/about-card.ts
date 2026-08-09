import { LitElement, css, html } from 'lit'
import { customElement } from 'lit/decorators.js'
import { author, description, version } from '../../package.json'
import { boxReset, card } from './shared-styles'
import { iconLogo } from './icons'

// 关于卡片：dev 页与独立关于页共用（信息单源，避免双处漂移）；
// 头像式 logo + 游戏名（比首页标题小一号），内容左对齐，无 tagline
@customElement('sf-about-card')
export class SfAboutCard extends LitElement {
  protected override render() {
    return html`
      <section class="card about">
        <div class="logo" aria-hidden="true">${iconLogo}</div>
        <h1>烧风</h1>
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

      .about .logo {
        display: flex;
        margin-bottom: 0.5rem;
      }

      .about .logo svg {
        width: 2.375rem;
        height: 2.375rem;
      }

      .about h1 {
        margin: 0 0 0.625rem;
        font-size: 1.375rem;
        font-weight: 700;
        letter-spacing: -0.01em;
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
