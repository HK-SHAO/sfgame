import { LitElement, css, html, nothing, type PropertyValues } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'
import { keyed } from 'lit/directives/keyed.js'
import { sfx } from '../core/sfx'
import { LEVELS, UPCOMING_LEVELS } from '../game/levels'
import { SfGame } from './sf-game'
import { urlState } from './state'
import type { HudState, LevelDef, SourcePlacement } from '../game/types'
import type { SourceKind } from '../sim/types'
import {
  iconBack,
  iconFlame,
  iconLock,
  iconLogo,
  iconReset,
  iconSnow,
  iconSoundOff,
  iconSoundOn,
} from './icons'

const FIRST_LEVEL = LEVELS[0]

type Screen = 'title' | 'game'

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
    // 初始化即读取 URL：?level=N 直接进入该关，?sources=... 携带放置状态
    const id = urlState.get('level')
    const level = id === null ? undefined : LEVELS.find((l) => l.id === id)
    if (level) {
      this.activeLevel = level
      this.initialSources = urlState.get('sources')
      this.screen = 'game'
    }
    // 双向绑定：浏览器前进/后退时 URL 变化 → 应用状态
    urlState.onChange('level', (v) => this.onUrlLevel(v))
    urlState.onChange('sources', (v) => this.gameEl?.applySources(v))
  }

  /** URL 的 level 变化（popstate）：有效关卡 → 进入/切换；无 → 回标题。 */
  private onUrlLevel(id: number | null) {
    const level = id === null ? undefined : LEVELS.find((l) => l.id === id)
    if (level) {
      this.activeLevel = level
      this.initialSources = urlState.get('sources')
      this.screen = 'game'
    } else if (this.screen === 'game') {
      this.screen = 'title'
    }
  }

  protected override willUpdate(changed: PropertyValues) {
    // 进入关卡前重置 HUD 为初始值：willUpdate 属于当前更新周期，不会额外调度更新；
    // 同时避免上一局结算覆盖层在挂载帧闪现。真正的 HUD 由 sf-game 的 hudchange 事件驱动。
    if (changed.has('screen') && this.screen === 'game') {
      this.hud = {
        phase: 'playing',
        hotLeft: FIRST_LEVEL.budget.hot,
        coldLeft: FIRST_LEVEL.budget.cold,
        placed: 0,
      }
    }
  }

  private startGame(id: number) {
    sfx.unlock()
    const level = LEVELS.find((l) => l.id === id) ?? FIRST_LEVEL
    this.activeLevel = level
    this.initialSources = urlState.get('sources')
    this.screen = 'game'
    urlState.set('level', level.id)
  }

  private backToTitle() {
    // 切回标题页即卸载 sf-game，其 disconnectedCallback 负责销毁游戏
    this.screen = 'title'
    urlState.clear('level')
    urlState.clear('sources')
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
    return this.screen === 'title' ? this.renderTitle() : this.renderGame()
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
                ${FIRST_LEVEL.hint}
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
      display: grid;
      place-items: center;
      padding: 24px;
      background:
        radial-gradient(circle at 18% 12%, rgba(255, 196, 83, 0.32), transparent 42%),
        linear-gradient(180deg, #fff8ea 0%, #f8e6c4 100%);
      overflow: auto;
    }

    .title-card {
      width: min(560px, 100%);
      padding: 36px 32px 28px;
      text-align: center;
      background: var(--card);
      backdrop-filter: blur(24px) saturate(1.4);
      -webkit-backdrop-filter: blur(24px) saturate(1.4);
      border: 1px solid rgba(255, 255, 255, 0.6);
      border-radius: 28px;
      corner-shape: squircle;
      box-shadow: 0 18px 44px rgba(61, 52, 39, 0.1);
    }

    .logo svg {
      width: 76px;
      height: 76px;
      margin: 0 auto;
    }

    h1 {
      margin: 14px 0 4px;
      font-size: 42px;
      font-weight: 700;
      letter-spacing: -0.02em;
      line-height: 1.1;
    }

    .tagline {
      margin: 0 0 26px;
      color: var(--ink-soft);
      font-size: 15px;
      letter-spacing: 0.06em;
    }

    .levels {
      display: flex;
      flex-direction: column;
      gap: 10px;
      text-align: left;
    }

    .level {
      display: flex;
      align-items: center;
      gap: 14px;
      width: 100%;
      padding: 12px 16px;
      border-radius: 16px;
      corner-shape: squircle;
      transition: transform 120ms ease-out, box-shadow 120ms ease-out;
    }

    .level.play {
      background: rgba(255, 255, 255, 0.72);
      border: 1px solid rgba(255, 255, 255, 0.8);
      box-shadow: 0 4px 14px rgba(61, 52, 39, 0.07);
    }

    .level.play:hover {
      box-shadow: 0 8px 22px rgba(61, 52, 39, 0.12);
    }

    .level.locked {
      background: rgba(255, 255, 255, 0.34);
      color: var(--ink-soft);
      opacity: 0.72;
    }

    .level .no {
      flex: none;
      font-size: 12px;
      color: var(--ink-soft);
      width: 44px;
    }

    .level .meta {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
    }

    .level .name {
      font-size: 16px;
      font-weight: 600;
      letter-spacing: 0.01em;
    }

    .level .concept {
      font-size: 12px;
      color: var(--ink-soft);
    }

    .level .go {
      font-size: 24px;
      line-height: 1;
      color: var(--hot);
      font-weight: 600;
    }

    .level .lock svg {
      width: 17px;
      height: 17px;
      color: var(--ink-soft);
    }

    .footnote {
      margin: 26px auto 0;
      max-width: 460px;
      font-size: 12px;
      line-height: 1.7;
      color: var(--ink-soft);
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
      gap: 10px;
      padding: calc(10px + env(safe-area-inset-top, 0px)) 14px 10px;
      pointer-events: none;
    }

    .hud > * {
      pointer-events: auto;
    }

    .hud-title {
      flex: 1;
      text-align: center;
      font-size: 14px;
      font-weight: 600;
      padding: 8px 14px;
      border-radius: 13px;
      corner-shape: squircle;
      background: rgba(255, 253, 248, 0.66);
      backdrop-filter: blur(16px) saturate(1.5);
      -webkit-backdrop-filter: blur(16px) saturate(1.5);
      border: 1px solid rgba(255, 255, 255, 0.55);
      box-shadow: 0 2px 10px rgba(61, 52, 39, 0.06);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .hud-title .no {
      color: var(--ink-soft);
      font-weight: 500;
      font-size: 12px;
      margin-right: 2px;
    }

    .hud-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .icon-btn {
      width: 38px;
      height: 38px;
      display: grid;
      place-items: center;
      border-radius: 12px;
      corner-shape: squircle;
      background: rgba(255, 253, 248, 0.66);
      backdrop-filter: blur(16px) saturate(1.5);
      -webkit-backdrop-filter: blur(16px) saturate(1.5);
      border: 1px solid rgba(255, 255, 255, 0.55);
      box-shadow: 0 2px 10px rgba(61, 52, 39, 0.06);
      color: var(--ink);
      transition: transform 100ms ease-out;
    }

    .icon-btn svg {
      width: 19px;
      height: 19px;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 38px;
      padding: 0 12px;
      border-radius: 12px;
      corner-shape: squircle;
      background: rgba(255, 253, 248, 0.66);
      backdrop-filter: blur(16px) saturate(1.5);
      -webkit-backdrop-filter: blur(16px) saturate(1.5);
      border: 1px solid rgba(255, 255, 255, 0.55);
      box-shadow: 0 2px 10px rgba(61, 52, 39, 0.06);
      font-size: 14px;
    }

    .chip svg {
      width: 15px;
      height: 15px;
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
      bottom: calc(14px + env(safe-area-inset-bottom, 0px));
      max-width: min(92%, 560px);
      margin: 0;
      padding: 10px 18px;
      text-align: center;
      font-size: 13px;
      line-height: 1.65;
      color: var(--ink);
      background: rgba(255, 253, 248, 0.72);
      backdrop-filter: blur(16px) saturate(1.5);
      -webkit-backdrop-filter: blur(16px) saturate(1.5);
      border: 1px solid rgba(255, 255, 255, 0.55);
      border-radius: 16px;
      corner-shape: squircle;
      box-shadow: 0 4px 18px rgba(61, 52, 39, 0.08);
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
        font-size: 12px;
        line-height: 1.6;
        padding: 9px 14px;
      }
    }

    /* ---------- 结算 ---------- */

    .overlay {
      position: absolute;
      inset: 0;
      z-index: 5;
      display: grid;
      place-items: center;
      padding: 24px;
      background: rgba(61, 52, 39, 0.2);
      backdrop-filter: blur(3px);
      -webkit-backdrop-filter: blur(3px);
      animation: fade 260ms ease-out;
    }

    .win-card {
      width: min(360px, 100%);
      padding: 30px 30px 26px;
      text-align: center;
      background: rgba(255, 252, 245, 0.94);
      border: 1px solid rgba(255, 255, 255, 0.7);
      border-radius: 26px;
      corner-shape: squircle;
      box-shadow: 0 24px 60px rgba(61, 52, 39, 0.22);
      animation: pop 340ms cubic-bezier(0.3, 1.35, 0.5, 1);
    }

    .win-card h2 {
      margin: 0 0 6px;
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }

    .win-card p {
      margin: 0 0 22px;
      font-size: 14px;
      color: var(--ink-soft);
    }

    .win-card .row {
      display: flex;
      gap: 10px;
      justify-content: center;
    }

    .win-card button {
      padding: 11px 22px;
      font-size: 15px;
      font-weight: 600;
      border-radius: 14px;
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
