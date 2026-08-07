import { LitElement, css, html, nothing, type PropertyValues } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'
import { keyed } from 'lit/directives/keyed.js'
import { sfx } from '../core/sfx'
import { LEVEL_ERRORS, LEVEL_GROUPS, LEVELS } from '../game/levels'
import { solutionsFor } from '../game/solutions'
import { DEV_OVERRIDE_EVENT } from '../game/session'
import { progress } from '../game/progress'
import { SfGame } from './sf-game'
import { DevTools } from '../dev/devtools'
import '../dev/dev-menu'
import './storage-view'
import './win-overlay'
import { urlState } from '../game/state'
import { screenFromUrl, type Screen, type ScreenState } from '../game/screen'
import type { HudState, LevelDef, SourcePlacement } from '../game/types'
import type { SourceKind } from '../sim/types'
import { boxReset } from './shared-styles'
import {
  iconFlame,
  iconGear,
  iconHome,
  iconLock,
  iconLogo,
  iconPause,
  iconPlay,
  iconReset,
  iconRoute,
  iconSnow,
  iconSoundOff,
  iconSoundOn,
} from './icons'

const FIRST_LEVEL = LEVELS[0]

@customElement('sf-app')
export class SfApp extends LitElement {
  @state() private screen: Screen = 'title'
  @state() private activeLevel: LevelDef = FIRST_LEVEL
  // 主页选项卡：纯本地 UI 态，不进 URL
  @state() private activeGroup = LEVEL_GROUPS[0]?.name ?? ''
  @state() private initialSources: SourcePlacement[] = []
  @state() private hud: HudState = {
    phase: 'playing',
    // 容错：LEVELS 全挂时初始化不得再抛
    hotLeft: FIRST_LEVEL?.budget.hot ?? 0,
    coldLeft: FIRST_LEVEL?.budget.cold ?? 0,
    placed: 0,
    time: 0,
    extra: 0,
    sources: 0,
    paused: false,
  }
  @state() private muted = sfx.muted
  private winRank = -1
  @state() private rate = 1
  @state() private dev = urlState.get('dev')
  // 面板由 app 持有：sf-game 重建不销毁
  private devTools: DevTools | null = null
  private get speedSteps(): number[] {
    return this.dev ? [1, 2, 4, 8, 16, 0.5] : [1, 2, 4, 0.5]
  }

  @query('sf-game') private gameEl!: SfGame

  constructor() {
    super()
    sfx.unlock()
    this.applyScreen(screenFromUrl())
    window.addEventListener(DEV_OVERRIDE_EVENT, this.onDevOverride)
    urlState.onChange('lv', () => this.applyScreen(screenFromUrl()))
    urlState.onChange('v', () => this.applyScreen(screenFromUrl()))
    urlState.onChange('src', (v) => {
      this.gameEl?.applySources(v)
      sfx.uiClick()
    })
  }

  override disconnectedCallback() {
    window.removeEventListener(DEV_OVERRIDE_EVENT, this.onDevOverride)
    this.devTools?.destroy()
    this.devTools = null
    super.disconnectedCallback()
  }

  // dev 覆写重建 sf-game 时面板不销毁：编辑器状态延续，便于连续迭代
  private syncDevTools() {
    if (this.screen === 'game' && this.dev) {
      if (!this.devTools) this.devTools = new DevTools()
    } else if (this.devTools) {
      this.devTools.destroy()
      this.devTools = null
    }
  }

  // dev 覆写生效：内联关卡文本压入 lv（编辑器已校验），清 src（浏览器返回即复原）
  private onDevOverride = (e: Event) => {
    const text = (e as CustomEvent<string>).detail
    urlState.set('lv', text)
    urlState.clear('src')
    this.applyScreen(screenFromUrl())
  }

  // URL 派生单入口：本地写（写读分离不回调）与外部变化（onChange）都经此应用，派生逻辑唯一在 game/screen.ts
  private applyScreen(s: ScreenState) {
    this.screen = s.screen
    // 非 game 屏保留旧关卡：渲染不依赖，且 keyed(activeLevel) 换关重建语义由引用变化驱动
    if (s.level) this.activeLevel = s.level
    this.initialSources = s.sources
  }

  private resetHud(level: LevelDef) {
    this.hud = {
      phase: 'playing',
      hotLeft: level.budget.hot,
      coldLeft: level.budget.cold,
      placed: 0,
      time: 0,
      extra: 0,
      sources: 0,
      paused: false,
    }
    this.winRank = -1
  }

  protected override willUpdate(changed: PropertyValues) {
    this.syncDevTools()
    // 渲染前重置（willUpdate 不额外调度），避免上局结算覆盖层闪现
    if (changed.has('screen') && this.screen === 'game') {
      this.resetHud(this.activeLevel)
    }
    if (changed.has('activeLevel') && this.screen === 'game') {
      this.resetHud(this.activeLevel)
    }
  }

  private startGame(id: number) {
    sfx.uiEnter()
    urlState.set('lv', id)
    urlState.clear('src')
    this.applyScreen(screenFromUrl())
  }

  private playNext() {
    const next = this.nextInGroup(this.activeLevel)
    if (!next) return
    sfx.uiEnter()
    // 同屏换关（screen 不变）：willUpdate 检测 activeLevel 变化重置 HUD，防上局 win 卡闪现
    urlState.set('lv', next.id)
    urlState.clear('src')
    this.applyScreen(screenFromUrl())
  }

  // 组内下一关：关卡组是主页组织单位，组尾无下一关
  private nextInGroup(level: LevelDef): LevelDef | undefined {
    const g = LEVEL_GROUPS.find((x) => x.name === level.group)
    if (!g) return undefined
    const i = g.levels.findIndex((l) => l.id === level.id)
    return i >= 0 ? g.levels[i + 1] : undefined
  }

  private goBack() {
    sfx.uiBack()
    // 仅应用内导航（pushState 带 sf 标记）才回退上一页；直达链接/外部进入回首页
    if (window.history.state && window.history.state.sf) window.history.back()
    else this.backToTitle()
  }

  private backToTitle() {
    sfx.uiBack()
    urlState.clear('lv')
    urlState.clear('src')
    urlState.clear('v')
    this.applyScreen(screenFromUrl())
  }

  private openStorage() {
    sfx.uiEnter()
    urlState.set('v', 'storage')
    this.applyScreen(screenFromUrl())
  }

  private openDev() {
    sfx.uiEnter()
    urlState.set('v', 'dev')
    this.applyScreen(screenFromUrl())
  }

  // dev 模式：关卡项上的参考解按钮——直达该关第一个注册解的摆法（省掉解法参考页）
  private openSolution(level: LevelDef) {
    const sol = solutionsFor(level.id)[0]
    if (!sol) return
    sfx.uiEnter()
    urlState.set('lv', level.id)
    urlState.set('src', sol.sources)
    urlState.clear('v')
    this.applyScreen(screenFromUrl())
  }

  // replace：切换不进历史（后退不会"撤销切换"）
  private toggleDev(e: CustomEvent<boolean>) {
    this.dev = e.detail
    urlState.set('dev', e.detail, { replace: true })
    sfx.uiClick()
  }

  private restart() {
    sfx.uiReset()
    this.gameEl?.restart()
  }

  private toggleSound() {
    this.muted = sfx.toggleMuted()
    if (!this.muted) sfx.uiClick()
  }

  private cycleSpeed() {
    const steps = this.speedSteps
    this.rate = steps[(steps.indexOf(this.rate) - 1 + steps.length) % steps.length]
    sfx.uiClick()
  }

  private speedLabel(): string {
    return this.rate < 1 ? '0.5×' : `${this.rate}×`
  }

  private onHudChange(e: CustomEvent<HudState>) {
    const next = e.detail
    const wasWon = this.hud.phase === 'won'
    this.hud = next
    if (next.phase === 'won' && !wasWon) this.recordWin()
  }

  private recordWin() {
    this.winRank = progress.record(this.activeLevel.id, {
      time: this.hud.time,
      extra: this.hud.extra,
      sources: urlState.get('src'),
    })
  }

  private onDeny(e: CustomEvent<SourceKind>) {
    this.denyChip(e.detail)
  }

  private onSourcesChange(e: CustomEvent<SourcePlacement[]>) {
    if (e.detail.length === 0) urlState.clear('src')
    else urlState.set('src', e.detail)
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
    if (this.screen === 'dev') {
      return html`<sf-dev-menu
        .dev=${this.dev}
        @back=${this.goBack}
        @open-storage=${this.openStorage}
        @toggle-dev=${this.toggleDev}
      ></sf-dev-menu>`
    }
    if (this.screen === 'storage') {
      return html`<sf-storage @back=${this.goBack}></sf-storage>`
    }
    return this.renderTitle()
  }

  private renderTitle() {
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
                  @click=${() => (this.activeGroup = g.name)}
                >
                  <span class="gname">${g.name}</span>
                </button>
              `,
            )}
          </nav>

          <nav class="levels" aria-label="关卡列表">
            ${LEVELS.filter((l) => l.group === this.activeGroup).map((l) => {
              // dev 模式全关卡可玩（含未解锁），参考解按钮嵌在卡片内
              const locked = !this.dev && !progress.isUnlocked(l.id)
              const hasSol = this.dev && solutionsFor(l.id).length > 0
              return html`
                <button
                  class="level play ${locked ? 'locked' : ''}"
                  ?disabled=${locked}
                  aria-label=${locked ? `第 ${l.id} 关（未解锁）` : `进入第 ${l.id} 关`}
                  @click=${() => this.startGame(l.id)}
                >
                  <span class="no">第 ${l.id} 关</span>
                  <span class="meta">
                    <span class="name">${l.name}</span>
                    <span class="concept">${l.tagline}</span>
                  </span>
                  ${hasSol
                    ? html`<span
                        class="sol-chip"
                        role="button"
                        tabindex="0"
                        aria-label="第 ${l.id} 关参考解"
                        title="参考解"
                        @click=${(e: Event) => {
                          e.stopPropagation()
                          this.openSolution(l)
                        }}
                        @keydown=${(e: KeyboardEvent) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            e.stopPropagation()
                            this.openSolution(l)
                          }
                        }}
                      >
                        ${iconRoute}
                      </span>`
                    : html`<span class="go" aria-hidden="true">${locked ? iconLock : '›'}</span>`}
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
            ? html`<button class="dev-link" @click=${this.openDev} aria-label="开发者页面">
                ${iconGear}<span>开发者页面</span>
              </button>`
            : nothing}
        </section>
      </main>
    `
  }

  private renderGame() {
    const won = this.hud.phase === 'won'
    const bestTotal = won ? progress.best(this.activeLevel.id)[0]?.total : undefined
    const hasNext = this.nextInGroup(this.activeLevel) !== undefined
    return html`
      <main class="game">
        ${keyed(
          // keyed 按对象身份重建：关卡内容变化时必须重建 sf-game
          this.activeLevel,
          html`<sf-game
            .level=${this.activeLevel}
            .initialSources=${this.initialSources}
            .rate=${this.rate}
            .devTools=${this.devTools}
            @hudchange=${this.onHudChange}
            @deny=${this.onDeny}
            @sourceschange=${this.onSourcesChange}
          ></sf-game>`,
        )}

        <header class="hud">
          <div class="hud-left">
            <button class="icon-btn" @click=${this.backToTitle} aria-label="回到主页" title="回到主页">
              ${iconHome}<span class="lbl">主页</span>
            </button>
          </div>
          <div class="hud-right">
            <span class="chip hot ${this.hud.hotLeft === 0 ? 'empty' : ''}" title="剩余热源">
              ${iconFlame}<span class="lbl">热源</span><b>${this.hud.hotLeft === Infinity ? '∞' : this.hud.hotLeft}</b>
            </span>
            <span class="chip cold ${this.hud.coldLeft === 0 ? 'empty' : ''}" title="剩余冷源">
              ${iconSnow}<span class="lbl">冷源</span><b>${this.hud.coldLeft === Infinity ? '∞' : this.hud.coldLeft}</b>
            </span>
            <button
              class="icon-btn pause"
              @click=${() => this.gameEl?.togglePause()}
              aria-label=${this.hud.paused ? '恢复' : '暂停'}
              aria-pressed=${this.hud.paused}
              title=${this.hud.paused ? '恢复' : '暂停'}
            >
              ${this.hud.paused ? iconPlay : iconPause}<span class="lbl">${this.hud.paused ? '恢复' : '暂停'}</span>
            </button>
            <button class="icon-btn speed" @click=${this.cycleSpeed} aria-label="游戏速率 ${this.speedLabel()}">
              <span class="lbl">速率</span><b>${this.speedLabel()}</b>
            </button>
            <button class="icon-btn" @click=${this.restart} aria-label="重置关卡">
              ${iconReset}<span class="lbl">重置</span>
            </button>
            <button
              class="icon-btn"
              @click=${this.toggleSound}
              aria-label=${this.muted ? '开启声音' : '关闭声音'}
              aria-pressed=${!this.muted}
            >
              ${this.muted ? iconSoundOff : iconSoundOn}<span class="lbl">声音</span>
            </button>
          </div>
        </header>

        ${won
          ? html`<sf-win-overlay
              .title=${this.activeLevel.win.title}
              .text=${this.activeLevel.win.text}
              .time=${this.hud.time}
              .extra=${this.hud.extra}
              .sources=${this.hud.sources}
              .bestTotal=${bestTotal}
              .rank=${this.winRank}
              .hasNext=${hasNext}
              @next=${this.playNext}
              @replay=${this.restart}
              @back=${this.backToTitle}
            ></sf-win-overlay>`
          : nothing}
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
        overflow: hidden;
        color: var(--ink);
        container-type: inline-size;
        /* 祖先 touch-action 约束全部后代：禁 iOS 双击按钮放大（视口 user-scalable=no 在开启辅助放大时被忽略）；
           画布自身 touch-action:none 取更严交集，拖尾/手势不受影响 */
        touch-action: manipulation;
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

    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
      }
    }

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
      font-size: 0.875rem;
      letter-spacing: 0.06em;
    }

    .levels {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
      text-align: left;
    }

    /* dev 模式参考解：嵌在关卡卡片内、与卡片同族的圆钮（替换右侧 › 箭头位） */
    .sol-chip {
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.125rem;
      height: 2.125rem;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.72);
      border: 1px solid rgba(255, 255, 255, 0.8);
      box-shadow: 0 0.125rem 0.5rem rgba(61, 52, 39, 0.07);
      color: var(--ink-soft);
      cursor: pointer;
      transition: color 120ms ease-out, background 120ms ease-out, transform 100ms ease-out;
    }

    .sol-chip:hover {
      color: var(--ink);
      background: #fff;
    }

    .sol-chip:active {
      transform: scale(0.94);
    }

    .sol-chip svg {
      width: 1.06rem;
      height: 1.06rem;
    }

    .groups {
      display: flex;
      justify-content: center;
      gap: 0.5rem;
      margin: 0 0 0.75rem;
    }

    .group-tab {
      flex: none;
    }

    .group-tab {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      gap: 1px;
      padding: 0.375rem 1.125rem;
      border-radius: 0.875rem;
      corner-shape: squircle;
      background: rgba(255, 255, 255, 0.55);
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
      margin: 0.75rem 0 0;
      color: var(--ink-soft);
      text-align: center;
    }

    .level-errors {
      margin-top: 0.875rem;
      padding: 0.625rem 0.75rem;
      text-align: left;
      font-size: 0.75rem;
      line-height: 1.45;
      color: #7a2415;
      background: rgba(255, 90, 60, 0.1);
      border: 1px solid rgba(255, 90, 60, 0.28);
      border-radius: 0.75rem;
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
      gap: 0.875rem;
      width: 100%;
      padding: 0.5rem 1rem;
      /* 覆盖卡片继承的 text-align:center */
      text-align: left;
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
      margin: 1rem auto 0;
      max-width: 28.75rem;
      font-size: 0.75rem;
      line-height: 1.7;
      color: var(--ink-soft);
    }

    .dev-link {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      margin-top: 0.75rem;
      padding: 0.5rem 1rem;
      font-size: 0.75rem;
      color: var(--ink-soft);
      background: rgba(255, 253, 248, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.6);
      border-radius: 999px;
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
      justify-content: space-between;
      gap: 0.5rem;
      padding: calc(0.5rem + env(safe-area-inset-top, 0px)) 0.625rem 0.5rem;
      pointer-events: none;
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
    }

    .hud > * {
      pointer-events: auto;
      flex: none;
    }

    .hud-left,
    .hud-right {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .lbl {
      display: none;
      white-space: nowrap;
    }

    /* <25rem ≈ 无标签内容宽：接管指针，否则滚动手势被下方 canvas 吃掉 */
    @container (max-width: 25rem) {
      .hud {
        pointer-events: auto;
        scrollbar-width: thin;
        scrollbar-color: rgba(61, 52, 39, 0.25) transparent;
      }
    }

    /* 39.7rem ≈ 带标签内容宽 */
    @container (min-width: 39.7rem) {
      .lbl {
        display: inline;
      }
    }

    .icon-btn {
      min-width: 2.5rem;
      height: 2.5rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.375rem;
      padding: 0 0.75rem;
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

    .icon-btn.speed b {
      font-variant-numeric: tabular-nums;
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
  `,
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-app': SfApp
  }
}
