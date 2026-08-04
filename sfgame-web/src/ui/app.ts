import { LitElement, css, html, nothing, type PropertyValues } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'
import { keyed } from 'lit/directives/keyed.js'
import { sfx } from '../core/sfx'
import { LEVELS, UPCOMING_LEVELS } from '../game/levels'
import { SfGame } from './sf-game'
import './solutions-view'
import { urlState } from '../game/state'
import type { HudState, LevelDef, SourcePlacement } from '../game/types'
import type { SourceKind } from '../sim/types'
import {
  iconBack,
  iconFlame,
  iconLock,
  iconLogo,
  iconReset,
  iconRoute,
  iconSnow,
  iconSoundOff,
  iconSoundOn,
} from './icons'

const FIRST_LEVEL = LEVELS[0]

type Screen = 'title' | 'game' | 'solutions'

@customElement('sf-app')
export class SfApp extends LitElement {
  @state() private screen: Screen = 'title'
  /** 当前进行的关卡（?level=N 直达 / 点击进入 / 浏览器后退切换） */
  @state() private activeLevel: LevelDef = FIRST_LEVEL
  /** 进入关卡时的初始源放置（来自 URL ?sources=...） */
  @state() private initialSources: SourcePlacement[] = []
  @state() private hud: HudState = {
    phase: 'playing',
    hotLeft: FIRST_LEVEL.budget.hot,
    coldLeft: FIRST_LEVEL.budget.cold,
    placed: 0,
  }
  @state() private muted = sfx.muted

  // 游戏画布宿主：仅声明式挂载，控制器生命周期由 sf-game 自身管理
  @query('sf-game') private gameEl!: SfGame

  constructor() {
    super()
    // 尽早武装音频解锁：任意首次交互（pointerdown/keydown）即获得权限
    sfx.unlock()
    // 初始化即从 URL 推导屏幕（?level=N 直达 / ?view=solutions 解法参考页）
    this.syncScreen()
    // 双向绑定：浏览器前进/后退时 URL 变化 → 应用状态
    urlState.onChange('level', () => this.syncScreen())
    urlState.onChange('view', () => this.syncScreen())
    urlState.onChange('sources', (v) => this.gameEl?.applySources(v))
  }

  /** 从 URL 状态统一推导屏幕：view=solutions 优先；其次 level 有效 → 游戏；否则标题。
   * 写读分离：set/clear 不触发通知，故 UI 操作需自行设 screen。 */
  private syncScreen() {
    if (urlState.get('view') === 'solutions') {
      this.screen = 'solutions'
      return
    }
    const id = urlState.get('level')
    const level = id === null ? undefined : LEVELS.find((l) => l.id === id)
    if (level) {
      this.activeLevel = level
      this.initialSources = urlState.get('sources')
      this.screen = 'game'
    } else {
      this.screen = 'title'
    }
  }

  protected override willUpdate(changed: PropertyValues) {
    // 进入关卡前重置 HUD 为初始值：willUpdate 属于当前更新周期，不会额外调度更新；
    // 同时避免上一局结算覆盖层在挂载帧闪现。真正的 HUD 由 sf-game 的 hudchange 事件驱动。
    if (changed.has('screen') && this.screen === 'game') {
      const b = this.activeLevel.budget
      this.hud = {
        phase: 'playing',
        hotLeft: b.hot,
        coldLeft: b.cold,
        placed: 0,
      }
    }
  }

  private startGame(id: number) {
    const level = LEVELS.find((l) => l.id === id) ?? FIRST_LEVEL
    this.activeLevel = level
    // 点关卡 = 新开一局：不继承 URL 里任何旧放置（否则跨关/残留 sources 会串到新局）
    this.initialSources = []
    this.screen = 'game'
    urlState.set('level', level.id)
    urlState.clear('sources')
  }

  private backToTitle() {
    // 切回标题页即卸载 sf-game，其 disconnectedCallback 负责销毁游戏
    this.screen = 'title'
    urlState.clear('level')
    urlState.clear('sources')
    urlState.clear('view')
  }

  private openSolutions() {
    this.screen = 'solutions'
    urlState.set('view', 'solutions')
  }

  private reset() {
    this.gameEl?.reset()
  }

  private toggleSound() {
    this.muted = sfx.toggleMuted()
  }

  private onHudChange(e: CustomEvent<HudState>) {
    this.hud = e.detail
  }

  private onDeny(e: CustomEvent<SourceKind>) {
    this.denyChip(e.detail)
  }

  /** 玩家放置/移除源 → 同步进 URL（?sources=...，可后退撤销、可分享） */
  private onSourcesChange(e: CustomEvent<SourcePlacement[]>) {
    if (e.detail.length === 0) urlState.clear('sources')
    else urlState.set('sources', e.detail)
  }

  private denyChip(kind: SourceKind) {
    void this.updateComplete.then(() => {
      const el = this.renderRoot.querySelector<HTMLElement>(`.chip.${kind}`)
      if (!el) return
      el.animate(
        [
          { transform: 'translateX(0)' },
          { transform: 'translateX(-3px)' },
          { transform: 'translateX(3px)' },
          { transform: 'translateX(-2px)' },
          { transform: 'translateX(0)' },
        ],
        { duration: 300, easing: 'ease-out' },
      )
    })
  }

  protected override render() {
    if (this.screen === 'game') return this.renderGame()
    if (this.screen === 'solutions') {
      return html`<sf-solutions @back=${this.backToTitle}></sf-solutions>`
    }
    return this.renderTitle()
  }

  private renderTitle() {
    return html`
      <main class="title">
        <section class="title-card">
          <div class="logo">${iconLogo}</div>
          <h1>造风</h1>
          <p class="tagline">太阳精灵 · 用温度创造风</p>

          <nav class="levels" aria-label="关卡列表">
            ${LEVELS.map(
              (l) => html`
                <button class="level play" @click=${() => this.startGame(l.id)}>
                  <span class="no">第 ${l.id} 关</span>
                  <span class="meta">
                    <span class="name">${l.name}</span>
                    <span class="concept">${l.tagline}</span>
                  </span>
                  <span class="go" aria-hidden="true">›</span>
                </button>
              `,
            )}
            ${UPCOMING_LEVELS.map(
              (l) => html`
                <div class="level locked" aria-disabled="true">
                  <span class="no">第 ${l.id} 关</span>
                  <span class="meta">
                    <span class="name">${l.name}</span>
                    <span class="concept">${l.tagline}</span>
                  </span>
                  <span class="lock">${iconLock}</span>
                </div>
              `,
            )}
          </nav>

          <p class="footnote">
            根据菲尔兹奖得主邓煜的数学证明，从牛顿力学可以推导出热力学方程——本游戏所有物理均基于此。
          </p>

          <button class="solutions-link" @click=${this.openSolutions}>
            ${iconRoute}<span>解法参考</span>
          </button>
        </section>
      </main>
    `
  }

  private renderGame() {
    const won = this.hud.phase === 'won'
    return html`
      <main class="game">
        ${keyed(
          this.activeLevel.id,
          html`<sf-game
            .level=${this.activeLevel}
            .initialSources=${this.initialSources}
            @hudchange=${this.onHudChange}
            @deny=${this.onDeny}
            @sourceschange=${this.onSourcesChange}
          ></sf-game>`,
        )}

        <header class="hud">
          <button class="icon-btn" @click=${this.backToTitle} aria-label="返回选关">
            ${iconBack}
          </button>
          <div class="hud-title">
            <span class="no">第 ${this.activeLevel.id} 关</span> ${this.activeLevel.name}
          </div>
          <div class="hud-right">
            <span class="chip hot ${this.hud.hotLeft === 0 ? 'empty' : ''}" title="剩余热源">
              ${iconFlame}<b>${this.hud.hotLeft}</b>
            </span>
            <span class="chip cold ${this.hud.coldLeft === 0 ? 'empty' : ''}" title="剩余冷源">
              ${iconSnow}<b>${this.hud.coldLeft}</b>
            </span>
            <button class="icon-btn" @click=${this.reset} aria-label="重置关卡">
              ${iconReset}
            </button>
            <button
              class="icon-btn"
              @click=${this.toggleSound}
              aria-label=${this.muted ? '开启声音' : '关闭声音'}
              aria-pressed=${!this.muted}
            >
              ${this.muted ? iconSoundOff : iconSoundOn}
            </button>
          </div>
        </header>

        ${this.hud.placed === 0 && !won
          ? html`
              <p class="caption">
                轻点放热源 · 长按放冷源 · 点按已放置的源可移除<br />
                ${this.activeLevel.hint}
              </p>
            `
          : nothing}
        ${won
          ? html`
              <div class="overlay" role="dialog" aria-label="过关">
                <div class="win-card">
                  <h2>飞起来了！</h2>
                  <p>纸飞机乘着热气流抵达了目标。</p>
                  <div class="row">
                    <button class="primary" @click=${this.reset}>再玩一次</button>
                    <button class="ghost" @click=${this.backToTitle}>选关</button>
                  </div>
                </div>
              </div>
            `
          : nothing}
      </main>
    `
  }

  static styles = css`
    /* shadow DOM 不继承全局 box-sizing，组件内必须自声明（否则 padding 撑爆 max-width） */
    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }

    :host {
      display: block;
      height: 100svh;
      height: 100dvh;
      overflow: hidden;
      color: var(--ink);
    }

    svg {
      display: block;
    }

    button {
      border: none;
      background: none;
      padding: 0;
      cursor: pointer;
      -webkit-user-select: none;
      user-select: none;
    }

    button:active {
      transform: scale(0.97);
    }

    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
      }
    }

    /* ---------- 标题页 ---------- */

    .title {
      height: 100%;
      display: flex;
      flex-direction: column;
      padding: 1.5rem;
      background:
        radial-gradient(circle at 18% 12%, rgba(255, 196, 83, 0.32), transparent 42%),
        linear-gradient(180deg, #fff8ea 0%, #f8e6c4 100%);
      overflow: auto;
    }

    /* flex 列 + margin:auto：宽度不足时 width:100% 撑满（padding 留白），
       宽屏时 max-width 封顶居中；溢出时 margin 塌缩为 0，从顶部可滚动 */
    .title-card {
      width: 100%;
      max-width: 35rem;
      margin: auto;
      padding: 1.75rem 2rem 1.375rem;
      text-align: center;
      background: var(--card);
      backdrop-filter: blur(1.5rem) saturate(1.4);
      -webkit-backdrop-filter: blur(1.5rem) saturate(1.4);
      border: 1px solid rgba(255, 255, 255, 0.6);
      border-radius: 1.75rem;
      corner-shape: squircle;
      box-shadow: 0 1.125rem 2.75rem rgba(61, 52, 39, 0.1);
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
      font-size: 0.94rem;
      letter-spacing: 0.06em;
    }

    .levels {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
      text-align: left;
    }

    .level {
      display: flex;
      align-items: center;
      gap: 0.875rem;
      width: 100%;
      padding: 0.5rem 1rem;
      border-radius: 1rem;
      corner-shape: squircle;
      transition: transform 120ms ease-out, box-shadow 120ms ease-out;
    }

    .level.play {
      background: rgba(255, 255, 255, 0.72);
      border: 1px solid rgba(255, 255, 255, 0.8);
      box-shadow: 0 0.25rem 0.875rem rgba(61, 52, 39, 0.07);
    }

    .level.play:hover {
      box-shadow: 0 0.5rem 1.375rem rgba(61, 52, 39, 0.12);
    }

    .level.locked {
      background: rgba(255, 255, 255, 0.34);
      color: var(--ink-soft);
      opacity: 0.72;
    }

    .level .no {
      flex: none;
      font-size: 0.75rem;
      color: var(--ink-soft);
      width: 2.75rem;
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
      font-size: 1.5rem;
      line-height: 1;
      color: var(--hot);
      font-weight: 600;
    }

    .level .lock svg {
      width: 1.06rem;
      height: 1.06rem;
      color: var(--ink-soft);
    }

    .footnote {
      margin: 1rem auto 0;
      max-width: 28.75rem;
      font-size: 0.75rem;
      line-height: 1.7;
      color: var(--ink-soft);
    }

    .solutions-link {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      margin-top: 0.75rem;
      padding: 0.5rem 1rem;
      font-size: 0.81rem;
      color: var(--ink-soft);
      background: rgba(255, 253, 248, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.6);
      border-radius: 999px;
      corner-shape: squircle;
      transition: color 120ms ease-out, box-shadow 120ms ease-out;
    }

    .solutions-link:hover {
      color: var(--ink);
      box-shadow: 0 0.25rem 0.875rem rgba(61, 52, 39, 0.08);
    }

    .solutions-link svg {
      width: 0.94rem;
      height: 0.94rem;
    }

    /* ---------- 游戏页 ---------- */

    .game {
      position: relative;
      height: 100%;
      background: #fdf7ec;
    }

    sf-game {
      position: absolute;
      inset: 0;
    }

    .hud {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      gap: 0.625rem;
      padding: calc(0.625rem + env(safe-area-inset-top, 0px)) 0.875rem 0.625rem;
      pointer-events: none;
    }

    .hud > * {
      pointer-events: auto;
    }

    .hud-title {
      flex: 1;
      text-align: center;
      font-size: 0.875rem;
      font-weight: 600;
      padding: 0.5rem 0.875rem;
      border-radius: 0.81rem;
      corner-shape: squircle;
      background: rgba(255, 253, 248, 0.66);
      backdrop-filter: blur(1rem) saturate(1.5);
      -webkit-backdrop-filter: blur(1rem) saturate(1.5);
      border: 1px solid rgba(255, 255, 255, 0.55);
      box-shadow: 0 0.125rem 0.625rem rgba(61, 52, 39, 0.06);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .hud-title .no {
      color: var(--ink-soft);
      font-weight: 500;
      font-size: 0.75rem;
      margin-right: 0.125rem;
    }

    .hud-right {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .icon-btn {
      width: 2.5rem;
      height: 2.5rem;
      display: grid;
      place-items: center;
      border-radius: 0.75rem;
      corner-shape: squircle;
      background: rgba(255, 253, 248, 0.66);
      backdrop-filter: blur(1rem) saturate(1.5);
      -webkit-backdrop-filter: blur(1rem) saturate(1.5);
      border: 1px solid rgba(255, 255, 255, 0.55);
      box-shadow: 0 0.125rem 0.625rem rgba(61, 52, 39, 0.06);
      color: var(--ink);
      transition: transform 100ms ease-out;
    }

    .icon-btn svg {
      width: 1.19rem;
      height: 1.19rem;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 0.31rem;
      height: 2.5rem;
      padding: 0 0.75rem;
      border-radius: 0.75rem;
      corner-shape: squircle;
      background: rgba(255, 253, 248, 0.66);
      backdrop-filter: blur(1rem) saturate(1.5);
      -webkit-backdrop-filter: blur(1rem) saturate(1.5);
      border: 1px solid rgba(255, 255, 255, 0.55);
      box-shadow: 0 0.125rem 0.625rem rgba(61, 52, 39, 0.06);
      font-size: 0.875rem;
    }

    .chip svg {
      width: 0.94rem;
      height: 0.94rem;
    }

    .chip.hot svg {
      color: var(--hot);
    }

    .chip.cold svg {
      color: var(--cold);
    }

    .chip b {
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    .chip.empty {
      opacity: 0.42;
    }

    .caption {
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
      bottom: calc(0.875rem + env(safe-area-inset-bottom, 0px));
      /* left:50% 的无宽绝对定位走 shrink-to-fit，可用空间只有容器一半；
         width:max-content 让宽度贴内容，max-width 再封顶换行 */
      width: max-content;
      max-width: min(92%, 35rem);
      margin: 0;
      padding: 0.625rem 1.125rem;
      text-align: center;
      font-size: 0.81rem;
      line-height: 1.65;
      color: var(--ink);
      background: rgba(255, 253, 248, 0.72);
      backdrop-filter: blur(1rem) saturate(1.5);
      -webkit-backdrop-filter: blur(1rem) saturate(1.5);
      border: 1px solid rgba(255, 255, 255, 0.55);
      border-radius: 1rem;
      corner-shape: squircle;
      box-shadow: 0 0.25rem 1.125rem rgba(61, 52, 39, 0.08);
      pointer-events: none;
      animation: rise 420ms cubic-bezier(0.22, 1, 0.36, 1);
    }

    /* 竖屏窄屏：关卡名让位给源计数与操作按钮（信息在选关页已有） */
    @media (orientation: portrait) and (max-width: 520px) {
      .hud-title {
        display: none;
      }

      .hud {
        justify-content: space-between;
      }

      .caption {
        font-size: 0.75rem;
        line-height: 1.6;
        padding: 0.56rem 0.875rem;
      }
    }

    /* ---------- 结算 ---------- */

    .overlay {
      position: absolute;
      inset: 0;
      z-index: 5;
      display: flex;
      flex-direction: column;
      padding: 1.5rem;
      background: rgba(61, 52, 39, 0.2);
      backdrop-filter: blur(0.19rem);
      -webkit-backdrop-filter: blur(0.19rem);
      animation: fade 260ms ease-out;
    }

    .win-card {
      width: 100%;
      max-width: 22.5rem;
      margin: auto;
      padding: 1.875rem 1.875rem 1.625rem;
      text-align: center;
      background: rgba(255, 252, 245, 0.94);
      border: 1px solid rgba(255, 255, 255, 0.7);
      border-radius: 1.625rem;
      corner-shape: squircle;
      box-shadow: 0 1.5rem 3.75rem rgba(61, 52, 39, 0.22);
      animation: pop 340ms cubic-bezier(0.3, 1.35, 0.5, 1);
    }

    .win-card h2 {
      margin: 0 0 0.375rem;
      font-size: 1.625rem;
      font-weight: 700;
      letter-spacing: -0.01em;
    }

    .win-card p {
      margin: 0 0 1.375rem;
      font-size: 0.875rem;
      color: var(--ink-soft);
    }

    .win-card .row {
      display: flex;
      gap: 0.625rem;
      justify-content: center;
    }

    .win-card button {
      padding: 0.6875rem 1.375rem;
      font-size: 0.94rem;
      font-weight: 600;
      border-radius: 0.875rem;
      corner-shape: squircle;
      transition: transform 100ms ease-out;
    }

    .win-card .primary {
      background: linear-gradient(180deg, #ff7a52, #ff5a3c);
      color: #fff;
      box-shadow: 0 6px 16px rgba(255, 90, 60, 0.35);
    }

    .win-card .ghost {
      background: rgba(61, 52, 39, 0.07);
      color: var(--ink);
    }

    @keyframes pop {
      from {
        opacity: 0;
        transform: scale(0.88);
      }
      to {
        opacity: 1;
        transform: scale(1);
      }
    }

    @keyframes fade {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    @keyframes rise {
      from {
        opacity: 0;
        transform: translateX(-50%) translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-app': SfApp
  }
}
