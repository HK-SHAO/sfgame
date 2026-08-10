import { LitElement, css, html } from 'lit'
import { customElement } from 'lit/decorators.js'
import { iconBack } from './icons.ts'
import { artBg, boxReset, pageShell } from './shared-styles.ts'
import './about-card'

// 关于页：与 dev/存储页同构，内容全部来自 sf-about-card
@customElement('sf-about')
export class SfAboutScreen extends LitElement {
  private onBack = () => this.dispatchEvent(new CustomEvent('back'))

  protected override render() {
    return html`
      <main class="page">
        <header class="bar">
          <div class="bar-inner">
            <button class="icon-btn" @click=${this.onBack} aria-label="返回">${iconBack}</button>
            <div class="head-text">
              <h1>关于</h1>
            </div>
          </div>
        </header>

        <sf-about-card></sf-about-card>
      </main>
    `
  }

  static styles = [
    boxReset,
    pageShell,
    artBg,
    css`
      :host {
        display: block;
        height: 100%;
        color: var(--ink);
      }
    `,
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-about': SfAboutScreen
  }
}
