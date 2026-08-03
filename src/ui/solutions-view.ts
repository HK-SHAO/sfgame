import { LitElement, css, html, nothing } from 'lit'
import { customElement } from 'lit/decorators.js'
import { LEVELS } from '../game/levels'
import { solutionsFor, solutionUrl, type LevelSolution } from '../game/solutions'
import type { LevelDef } from '../game/types'
import { iconBack } from './icons'

/**
 * 解法参考页：逐关列出解的相对 URL（点击即进入对应摆放）。
 * 纯声明式：无状态、无副作用。
 */
@customElement('sf-solutions')
export class SfSolutions extends LitElement {
  private onBack = () => this.dispatchEvent(new CustomEvent('back'))

  private row(level: LevelDef, sol: LevelSolution) {
    const href = solutionUrl(level.id, sol)
    return html`
      <a class="row" href=${href}>
        <div class="row-head">
          <span class="name">${sol.name}</span>
          <span class="time">≈ ${Math.round(sol.winTime)} 秒</span>
        </div>
        <code class="url">${href}</code>
        <p class="note">${sol.note}</p>
      </a>
    `
  }

  protected override render() {
    return html`
      <main class="page">
        <header class="head">
          <button class="icon-btn" @click=${this.onBack} aria-label="返回">${iconBack}</button>
          <div class="head-text">
            <h1>解法参考</h1>
            <p>点击解，进入对应摆放</p>
          </div>
        </header>
        ${LEVELS.map((l) =>
          solutionsFor(l.id).length === 0
            ? nothing
            : html`
                <section class="level">
                  <h2>
                    <span class="no">第 ${l.id} 关</span>
                    <span class="name">${l.name}</span>
                  </h2>
                  <div class="rows">
                    ${solutionsFor(l.id).map((s) => this.row(l, s))}
                  </div>
                </section>
              `,
        )}
      </main>
    `
  }

  static styles = css`
    :host {
      display: block;
      height: 100%;
    }

    .page {
      height: 100%;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding:
        calc(14px + env(safe-area-inset-top, 0px)) 18px
        calc(30px + env(safe-area-inset-bottom, 0px));
      background:
        radial-gradient(circle at 84% 10%, rgba(255, 196, 83, 0.22), transparent 42%),
        linear-gradient(180deg, #fff8ea 0%, #f8e6c4 100%);
    }

    .head {
      display: flex;
      align-items: center;
      gap: 12px;
      max-width: 560px;
      margin: 0 auto 20px;
    }

    .icon-btn {
      flex: none;
      width: 38px;
      height: 38px;
      display: grid;
      place-items: center;
      border: none;
      border-radius: 12px;
      corner-shape: squircle;
      background: rgba(255, 253, 248, 0.66);
      backdrop-filter: blur(16px) saturate(1.5);
      -webkit-backdrop-filter: blur(16px) saturate(1.5);
      border: 1px solid rgba(255, 255, 255, 0.55);
      box-shadow: 0 2px 10px rgba(61, 52, 39, 0.06);
      color: var(--ink);
      cursor: pointer;
      padding: 0;
    }

    .icon-btn:active {
      transform: scale(0.97);
    }

    .icon-btn svg {
      width: 19px;
      height: 19px;
    }

    .head-text h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 700;
      letter-spacing: 0.01em;
    }

    .head-text p {
      margin: 2px 0 0;
      font-size: 12px;
      color: var(--ink-soft);
    }

    .level {
      max-width: 560px;
      margin: 0 auto 24px;
    }

    .level h2 {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin: 0 0 10px;
      font-size: 16px;
      font-weight: 700;
    }

    .level h2 .no {
      color: var(--ink-soft);
      font-size: 12px;
      font-weight: 600;
      flex: none;
    }

    .rows {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .row {
      display: block;
      padding: 14px 16px;
      background: var(--card);
      border: 1px solid rgba(255, 255, 255, 0.6);
      border-radius: 16px;
      corner-shape: squircle;
      box-shadow: 0 8px 22px rgba(61, 52, 39, 0.07);
      color: inherit;
      text-decoration: none;
      transition: transform 120ms ease-out, box-shadow 120ms ease-out;
    }

    .row:hover {
      transform: translateY(-1px);
      box-shadow: 0 12px 26px rgba(61, 52, 39, 0.12);
    }

    .row:active {
      transform: scale(0.98);
    }

    .row-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
    }

    .row-head .name {
      font-size: 15px;
      font-weight: 600;
    }

    .time {
      flex: none;
      font-size: 12px;
      color: var(--ink-soft);
    }

    .url {
      display: block;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      line-height: 1.5;
      color: var(--ink-soft);
      word-break: break-all;
    }

    .note {
      margin: 8px 0 0;
      font-size: 12px;
      line-height: 1.6;
      color: var(--ink-soft);
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-solutions': SfSolutions
  }
}
