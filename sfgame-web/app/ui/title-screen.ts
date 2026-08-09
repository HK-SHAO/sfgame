import { LitElement, css, html, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { LEVEL_ERRORS, LEVEL_GROUPS, LEVELS, LEVELS_BY_ID, isUnlocked, levelHash } from '../game/levels'
import { progress } from '../game/progress'
import type { LevelDef } from '../game/types'
import { artBg, boxReset, reduceMotion } from './shared-styles'
import { iconGear, iconLock, iconLogo } from './icons'

// 主页关卡选择屏：从 app.ts 拆出（app 收敛为路由 + 结算 + dev 生命周期）
@customElement('sf-title-screen')
export class SfTitleScreen extends LitElement {
  @property({ type: Boolean }) dev = false
  @property({ type: String }) activeGroup = ''

  private startLevel(id: number) {
    this.dispatchEvent(new CustomEvent<number>('start', { detail: id }))
  }

  protected override render() {
    const group = LEVEL_GROUPS.find((g) => g.name === this.activeGroup)
    return html`
      <main class="title">
        <section class="title-card">
          <div class="logo">${iconLogo}</div>
          <h1>烧风</h1>
          <p class="tagline">太阳精灵 · 用温度创造风</p>

          <nav class="groups" aria-label="关卡组">
            ${LEVEL_GROUPS.map((g) =>
              html`
                <button
                  class="group-tab ${g.name === this.activeGroup ? 'active' : ''}"
                  aria-pressed=${g.name === this.activeGroup}
                  @click=${() => this.dispatchEvent(new CustomEvent<string>('group', { detail: g.name }))}
                >
                  <span class="gname">${g.name}</span>
                </button>
              `,
            )}
          </nav>

          <nav class="levels" aria-label="关卡列表">
            ${(group?.ids ?? [])
              .map((id) => LEVELS_BY_ID.get(id))
              .filter((l): l is LevelDef => l !== undefined)
              .map((l) => {
                // dev 模式全关卡可玩（含未解锁）；解锁按关卡 hash 的通关记录判定
                const locked = !this.dev && !isUnlocked(l.id, (id) => progress.completed(levelHash(id) ?? ''))
                return html`
                  <button
                    class="level play ${locked ? 'locked' : ''}"
                    ?disabled=${locked}
                    aria-label=${locked ? `第 ${l.id} 关（未解锁）` : `进入第 ${l.id} 关`}
                    @click=${() => this.startLevel(l.id)}
                  >
                    <span class="no">第 ${l.id} 关</span>
                    <span class="meta">
                      <span class="name">${l.name}</span>
                      <span class="concept">${l.tagline}</span>
                    </span>
                    <span class="go" aria-hidden="true">${locked ? iconLock : '›'}</span>
                  </button>
                `
              })}
            ${LEVELS.length === 0 ? html`<p class="no-levels">暂无可用关卡</p>` : nothing}
          </nav>

          ${LEVEL_ERRORS.length > 0
            ? html`<div class="level-errors" role="alert">
                <b>关卡加载失败 ${LEVEL_ERRORS.length} 个</b>
                ${LEVEL_ERRORS.map((m) => html`<p>${m}</p>`)}
              </div>`
            : nothing}

          <p class="footnote">
            根据菲尔兹奖得主邓煜的数学证明，从牛顿力学可以推导出热力学方程——本游戏所有物理均基于此。
          </p>

          ${this.dev
            ? html`<button class="dev-link" @click=${() => this.dispatchEvent(new Event('dev-page'))} aria-label="开发者页面">
                ${iconGear}<span>开发者页面</span>
              </button>`
            : nothing}
        </section>
      </main>
    `
  }

  static styles = [
    boxReset,
    reduceMotion,
    artBg,
    css`
      :host {
        display: block;
        height: 100%;
      }

      svg {
        display: block;
      }

      button {
        border: none;
        background: none;
        padding: 0;
        cursor: pointer;
        color: inherit;
        -webkit-user-select: none;
        user-select: none;
      }

      button:active {
        transform: scale(0.97);
      }

      .title {
        height: 100%;
        display: flex;
        flex-direction: column;
        /* 横屏刘海/Dynamic Island 在侧边，须加左/右安全区 */
        padding: var(--page-pad-y) calc(var(--page-pad-x) + env(safe-area-inset-right, 0px))
          var(--page-pad-y) calc(var(--page-pad-x) + env(safe-area-inset-left, 0px));
        overflow: auto;
        scrollbar-width: thin;
        scrollbar-color: var(--scroll-thumb) transparent;
      }

      .title-card {
        width: 100%;
        max-width: var(--maxw-card);
        margin: auto;
        padding: var(--card-pad);
        text-align: center;
        /* 白雾玻璃：半透明白 + 轻模糊，背景图若隐若现（比其余页卡片更透） */
        background: rgba(255, 252, 245, 0.55);
        backdrop-filter: blur(1rem) saturate(1.3);
        -webkit-backdrop-filter: blur(1rem) saturate(1.3);
        border: 1px solid rgba(255, 255, 255, 0.6);
        border-radius: var(--r-xl);
        corner-shape: squircle;
        box-shadow: 0 1.125rem 2.75rem rgba(61, 52, 39, 0.14);
      }

      .logo svg {
        width: 3.25rem;
        height: 3.25rem;
        margin: 0 auto;
      }

      h1 {
        margin: 0.625rem 0 0.25rem;
        font-size: 2.125rem;
        font-weight: 700;
        letter-spacing: -0.02em;
        line-height: 1.1;
      }

      .tagline {
        margin: 0 0 1rem;
        color: var(--ink-soft);
        font-size: 0.875rem;
        letter-spacing: 0.06em;
      }

      .levels {
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
        text-align: left;
      }

      .groups {
        display: flex;
        justify-content: center;
        gap: var(--sp-2);
        margin: 0 0 var(--sp-3);
      }

      .group-tab {
        flex: none;
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        gap: 1px;
        padding: 0.375rem var(--sp-5);
        border-radius: var(--r-lg);
        corner-shape: squircle;
        background: rgba(255, 255, 255, 0.4);
        border: 1px solid rgba(255, 255, 255, 0.7);
        color: var(--ink-soft);
        transition: background 140ms ease-out, color 140ms ease-out, box-shadow 140ms ease-out;
      }

      .group-tab .gname {
        font-size: 0.9375rem;
        font-weight: 700;
        letter-spacing: 0.04em;
      }

      .group-tab.active {
        background: var(--card);
        color: var(--ink);
        box-shadow: 0 0.25rem 0.875rem rgba(61, 52, 39, 0.09);
      }

      .no-levels {
        margin: var(--sp-3) 0 0;
        color: var(--ink-soft);
        text-align: center;
      }

      .level-errors {
        margin-top: var(--sp-4);
        padding: 0.625rem var(--sp-3);
        text-align: left;
        font-size: 0.75rem;
        line-height: 1.45;
        color: #7a2415;
        background: rgba(255, 90, 60, 0.1);
        border: 1px solid rgba(255, 90, 60, 0.28);
        border-radius: var(--r-md);
        corner-shape: squircle;
        overflow: hidden;
      }

      .level-errors p {
        margin: 0.25rem 0 0;
        word-break: break-all;
      }

      .level {
        display: flex;
        align-items: center;
        gap: var(--sp-4);
        width: 100%;
        padding: var(--sp-2) var(--sp-4);
        /* 覆盖卡片继承的 text-align:center */
        text-align: left;
        border-radius: var(--r-lg);
        corner-shape: squircle;
        transition: transform 120ms ease-out, box-shadow 120ms ease-out;
      }

      .level.play {
        background: rgba(255, 255, 255, 0.5);
        border: 1px solid rgba(255, 255, 255, 0.8);
        box-shadow: 0 0.25rem 0.875rem rgba(61, 52, 39, 0.07);
      }

      .level.play:hover {
        box-shadow: 0 0.5rem 1.375rem rgba(61, 52, 39, 0.12);
      }

      .level .no {
        flex: none;
        font-size: 0.75rem;
        color: var(--ink-soft);
        width: 2.75rem;
      }

      .level.locked {
        background: rgba(255, 255, 255, 0.42);
        border-color: rgba(255, 255, 255, 0.5);
        box-shadow: none;
        opacity: 0.55;
        cursor: not-allowed;
      }

      .level.locked:hover {
        transform: none;
        box-shadow: none;
      }

      .level.locked .go {
        color: var(--ink-soft);
      }

      .level .meta {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
      }

      .level .name {
        font-size: 1rem;
        font-weight: 600;
        letter-spacing: 0.01em;
      }

      .level .concept {
        font-size: 0.75rem;
        color: var(--ink-soft);
      }

      .level .go {
        flex: none;
        font-size: 1.5rem;
        line-height: 1;
        color: var(--hot);
        font-weight: 600;
      }

      .level .go svg {
        display: block;
        width: 1.06rem;
        height: 1.06rem;
      }

      .footnote {
        margin: var(--sp-4) auto 0;
        max-width: 28.75rem;
        font-size: 0.75rem;
        line-height: 1.7;
        color: var(--ink-soft);
      }

      .dev-link {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        margin-top: var(--sp-3);
        padding: var(--sp-2) var(--sp-4);
        font-size: 0.75rem;
        color: var(--ink-soft);
        background: rgba(255, 253, 248, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.6);
        border-radius: var(--r-pill);
        corner-shape: squircle;
        transition: color 120ms ease-out, box-shadow 120ms ease-out;
      }

      .dev-link:hover {
        color: var(--ink);
        box-shadow: 0 0.25rem 0.875rem rgba(61, 52, 39, 0.08);
      }

      .dev-link svg {
        width: 0.94rem;
        height: 0.94rem;
      }
    `,
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-title-screen': SfTitleScreen
  }
}
