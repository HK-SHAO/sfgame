import { LitElement, css, html, nothing, type PropertyValues } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'
import { keyed } from 'lit/directives/keyed.js'
import { sfx } from '../core/sfx'
import { LEVEL_ERRORS, LEVELS } from '../game/levels'
import { DEV_OVERRIDE_EVENT, DEV_SLOT, resolveLevel } from '../game/session'
import { progress } from '../game/progress'
import { SfGame } from './sf-game'
import './dev-menu'
import './solutions-view'
import './storage-view'
import { urlState } from '../game/state'
import { formatPenalty, formatTime } from '../game/timer'
import type { HudState, LevelDef, SourcePlacement } from '../game/types'
import type { SourceKind } from '../sim/types'
import {
  iconBack,
  iconFlame,
  iconGear,
  iconHome,
  iconLock,
  iconLogo,
  iconReset,
  iconSnow,
  iconSoundOff,
  iconSoundOn,
} from './icons'

const FIRST_LEVEL = LEVELS[0]
type Screen = 'title' | 'game' | 'solutions' | 'dev' | 'storage'

@customElement('sf-app')
export class SfApp extends LitElement {
  @state() private screen: Screen = 'title'
  /** 当前进行的关卡（?lv=N 直达 / 点击进入 / 浏览器后退切换） */
  @state() private activeLevel: LevelDef = FIRST_LEVEL
  /** 进入关卡时的初始源放置（来自 URL ?src=...） */
  @state() private initialSources: SourcePlacement[] = []
  @state() private hud: HudState = {
    phase: 'playing',
    // 容错：关卡全挂（LEVELS 空）时字段初始化不得再抛（模块级已兜底）
    hotLeft: FIRST_LEVEL?.budget.hot ?? 0,
    coldLeft: FIRST_LEVEL?.budget.cold ?? 0,
    placed: 0,
    time: 0,
    extra: 0,
    sources: 0,
  }
  @state() private muted = sfx.muted
  /** 最近一次通关在该关成绩榜的排名（-1 = 未进榜），win 卡"新纪录"依据 */
  private winRank = -1
  /** 游戏速率档位：点按向减速方向循环（1× 默认，0.5× 细看，2×~4× 快进；
   * dev 模式（?dev=1）额外开放 8×/16× 高速档） */
  @state() private rate = 1
  /** 开发者模式：?dev=1 开启 perf 叠加层与 8×/16× 高速档，普通玩家无 */
  @state() private dev = urlState.get('dev')
  /** 速率档位序列（数组顺序即循环顺序，越靠后越小） */
  private get speedSteps(): number[] {
    return this.dev ? [1, 2, 4, 8, 16, 0.5] : [1, 2, 4, 0.5]
  }

  @query('sf-game') private gameEl!: SfGame

  constructor() {
    super()
    // 尽早武装音频解锁：任意首次交互（pointerdown/keydown）即获得权限
    sfx.unlock()
    this.syncScreen()
    // dev 面板 YAML 编辑生效（临时覆写，见 game/session.ts）
    window.addEventListener(DEV_OVERRIDE_EVENT, this.onDevOverride)
    // 双向绑定：浏览器前进/后退时 URL 变化 → 应用状态
    urlState.onChange('lv', () => this.syncScreen())
    urlState.onChange('v', () => this.syncScreen())
    urlState.onChange('src', (v) => {
      this.gameEl?.applySources(v)
      // 撤销/重做（仅外部 URL 变化触发，玩家自身操作不触发）轻反馈
      sfx.uiClick()
    })
  }

  override disconnectedCallback() {
    window.removeEventListener(DEV_OVERRIDE_EVENT, this.onDevOverride)
    super.disconnectedCallback()
  }

  /** dev 面板确认生效：切到 lv=0 编辑槽并清掉来源放置（浏览器返回即复原）。 */
  private onDevOverride = () => {
    const level = resolveLevel(DEV_SLOT)
    if (!level) return
    this.activeLevel = level
    this.initialSources = []
    urlState.set('lv', DEV_SLOT)
    urlState.clear('src')
  }

  /** 从 URL 统一推导屏幕（view=solutions/dev/storage 优先 → level 有效 → 标题）。写读分离：set/clear 不触发通知，UI 操作需自行设 screen。 */
  private syncScreen() {
    const v = urlState.get('v')
    if (v === 'solutions') {
      this.screen = 'solutions'
      return
    }
    if (v === 'dev') {
      this.screen = 'dev'
      return
    }
    if (v === 'storage') {
      this.screen = 'storage'
      return
    }
    const id = urlState.get('lv')
    const level = id === null ? undefined : resolveLevel(id)
    if (level) {
      this.activeLevel = level
      this.initialSources = urlState.get('src')
      this.screen = 'game'
    } else {
      this.screen = 'title'
    }
  }

  /** 重置结算/HUD 状态（进关与"下一关"复用；HUD 由 sf-game 的 hudchange 事件驱动） */
  private resetHud(level: LevelDef) {
    this.hud = {
      phase: 'playing',
      hotLeft: level.budget.hot,
      coldLeft: level.budget.cold,
      placed: 0,
      time: 0,
      extra: 0,
      sources: 0,
    }
    this.winRank = -1
  }

  protected override willUpdate(changed: PropertyValues) {
    // 进关卡前重置 HUD（willUpdate 属当前周期不额外调度；避免上局结算覆盖层闪现）
    if (changed.has('screen') && this.screen === 'game') {
      this.resetHud(this.activeLevel)
    }
    // 关卡内容变化（dev 面板生效/浏览器返回复原，keyed 按对象身份重建）：同上防闪现
    if (changed.has('activeLevel') && this.screen === 'game') {
      this.resetHud(this.activeLevel)
    }
  }

  private startGame(id: number) {
    sfx.uiEnter()
    const level = resolveLevel(id) ?? FIRST_LEVEL
    if (!level) return // 关卡全挂时无路可进（标题页已显示告警）
    this.activeLevel = level
    // 点关卡 = 新开一局：不继承 URL 里任何旧放置（否则跨关/残留 sources 会串到新局）
    this.initialSources = []
    this.screen = 'game'
    urlState.set('lv', level.id)
    urlState.clear('src')
  }

  /** 过关弹窗「下一关」：顺序前进，仅当存在下一关时显示。 */
  private playNext() {
    const next = resolveLevel(this.activeLevel.id + 1)
    if (!next) return
    sfx.uiEnter()
    this.activeLevel = next
    this.initialSources = []
    // 同屏换关（screen 不变），需手动重置结算状态，避免上局 win 卡闪现
    this.resetHud(next)
    urlState.set('lv', next.id)
    urlState.clear('src')
  }

  /** 返回上一状态（等同浏览器后退）：URL 驱动屏幕推导（popstate → syncScreen），
   * 同关卡内退回即撤销 src、跨页退回即回解法页/标题页。直达链接无历史可退时兜底回标题。 */
  private goBack() {
    sfx.uiBack()
    if (window.history.length > 1) window.history.back()
    else this.backToTitle()
  }

  private backToTitle() {
    // 切回标题页即卸载 sf-game，销毁由 disconnectedCallback 负责
    sfx.uiBack()
    this.screen = 'title'
    urlState.clear('lv')
    urlState.clear('src')
    urlState.clear('v')
  }

  private openSolutions() {
    sfx.uiEnter()
    this.screen = 'solutions'
    urlState.set('v', 'solutions')
  }

  private openDev() {
    sfx.uiEnter()
    this.screen = 'dev'
    urlState.set('v', 'dev')
  }

  private openStorage() {
    sfx.uiEnter()
    this.screen = 'storage'
    urlState.set('v', 'storage')
  }

  /** 开发者页面内开关 dev 模式（?dev=1 控制 perf 叠加层/高速档/空格暂停/主菜单开发者入口）。
   * 开关是轻量操作：replace 改写当前历史条目，来回切换不产生"撤销切换"的后退噪声 */
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
    // 恢复声音时给确认音；静音时静默（静默本身即反馈）
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
    // 通关瞬间记录进度（仅每次"进入通关"记录一次，restart 重玩后再赢会再记）
    if (next.phase === 'won' && !wasWon) this.recordWin()
  }

  /** 记录通关成绩榜 + 解法：用时/罚时来自 HUD，解法摆放即 URL src（始终镜像场上源）。 */
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

  /** 玩家放置/移除源 → 同步进 URL（?src=...，可后退撤销、可分享） */
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
        @open-solutions=${this.openSolutions}
        @open-storage=${this.openStorage}
        @toggle-dev=${this.toggleDev}
      ></sf-dev-menu>`
    }
    if (this.screen === 'storage') {
      return html`<sf-storage @back=${this.goBack}></sf-storage>`
    }
    if (this.screen === 'solutions') {
      return html`<sf-solutions @back=${this.goBack}></sf-solutions>`
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

          <nav class="levels" aria-label="关卡列表">
            ${LEVELS.map((l) => {
              const locked = !progress.isUnlocked(l.id)
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
                  <span class="go" aria-hidden="true">${locked ? iconLock : '›'}</span>
                </button>
              `
            })}
            ${LEVELS.length === 0 ? html`<p class="no-levels">暂无可用关卡</p>` : nothing}
          </nav>

          <!-- 关卡文件加载失败告警（容错加载，见 game/levels.ts）：白屏改可见错误 -->
          ${LEVEL_ERRORS.length > 0
            ? html`<div class="level-errors" role="alert">
                <b>关卡加载失败 ${LEVEL_ERRORS.length} 个</b>
                ${LEVEL_ERRORS.map((m) => html`<p>${m}</p>`)}
              </div>`
            : nothing}

          <p class="footnote">
            根据菲尔兹奖得主邓煜的数学证明，从牛顿力学可以推导出热力学方程——本游戏所有物理均基于此。
          </p>

          <!-- 开发者入口仅 dev 模式可见（?dev=1）；dev 开关在开发者页面里 -->
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
    const hasNext = LEVELS.some((l) => l.id === this.activeLevel.id + 1)
    return html`
      <main class="game">
        ${keyed(
          // keyed 按关卡对象身份：dev 面板生效/返回复原时内容变了，必须重建 sf-game
          this.activeLevel,
          html`<sf-game
            .level=${this.activeLevel}
            .initialSources=${this.initialSources}
            .rate=${this.rate}
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
            <button class="icon-btn" @click=${this.goBack} aria-label="返回上一状态" title="返回上一状态">
              ${iconBack}<span class="lbl">返回</span>
            </button>
          </div>
          <div class="hud-right">
            <span class="chip hot ${this.hud.hotLeft === 0 ? 'empty' : ''}" title="剩余热源">
              ${iconFlame}<span class="lbl">热源</span><b>${this.hud.hotLeft === Infinity ? '∞' : this.hud.hotLeft}</b>
            </span>
            <span class="chip cold ${this.hud.coldLeft === 0 ? 'empty' : ''}" title="剩余冷源">
              ${iconSnow}<span class="lbl">冷源</span><b>${this.hud.coldLeft === Infinity ? '∞' : this.hud.coldLeft}</b>
            </span>
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
          ? html`
              <div class="overlay" role="dialog" aria-label="过关">
                <div class="win-card">
                  <h2>${this.activeLevel.win.title}</h2>
                  <p class="desc">${this.activeLevel.win.text}</p>
                  <p class="stats">
                    <b class="total">合计 ${formatTime(this.hud.time + this.hud.extra)}</b>
                    <span class="line">用时 ${formatTime(this.hud.time)}</span>
                    <span class="line extra"
                      >额外 ${this.hud.extra > 0 ? `${formatPenalty(this.hud.extra)}（使用 ${this.hud.sources} 个道具）` : '无'}</span
                    >
                    ${bestTotal !== undefined
                      ? html`<span class="line record"
                          >本关最佳 ${formatTime(bestTotal)}${this.winRank === 0 ? ' · 新纪录' : ''}</span
                        >`
                      : nothing}
                  </p>
                  <div class="row">
                    <button class="primary next" @click=${hasNext ? this.playNext : this.restart}>
                      ${hasNext ? '下一关' : '再玩一次'}
                    </button>
                  </div>
                  <div class="row">
                    ${hasNext ? html`<button class="ghost" @click=${this.restart}>再玩一次</button>` : nothing}
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
      /* HUD 两态自适应（标签显隐/滚动兜底）用容器查询，零 JS；
         组件尺寸全 rem，临界宽度按内容宽取（见 .hud 下的 @container） */
      container-type: inline-size;
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
      font-size: 0.875rem;
      letter-spacing: 0.06em;
    }

    .levels {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
      text-align: left;
    }

    .no-levels {
      margin: 0.75rem 0 0;
      color: var(--ink-soft);
      text-align: center;
    }

    /* 关卡文件加载失败告警：柔红底小卡，置于关卡列表下（见 renderTitle） */
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
      /* 标题卡片 text-align:center 会被继承，按钮内文本须回归居左 */
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

    /* 锁定关：灰色 + not-allowed 指针，无悬停反馈；解锁进度 = 上一关通关 */
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

    /* 开发者页面入口：同款胶囊，低调地居底 */
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
      /* 两端对齐：左侧导航组/右侧操作组贴边，组内间距统一 0.5rem */
      justify-content: space-between;
      gap: 0.5rem;
      padding: calc(0.5rem + env(safe-area-inset-top, 0px)) 0.625rem 0.5rem;
      pointer-events: none;
      /* 子项不压缩；空间不够时整条横向滚动（见下方 @container） */
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
    }

    .hud > * {
      pointer-events: auto;
      flex: none;
    }

    /* 左右两组：space-between 的弹性空隙只出现在两组之间，组内间距统一 0.5rem */
    .hud-left,
    .hud-right {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    /* 按钮文本标签：默认隐藏，宽屏（内容放得下）时由容器查询显示 */
    .lbl {
      display: none;
      white-space: nowrap;
    }

    /* 窄容器（<25rem ≈ 无标签内容宽）：内容放不下 → 显示滚动条并接管指针
       （touch/wheel 滚动；否则事件会被下方 canvas 吃掉） */
    @container (max-width: 25rem) {
      .hud {
        pointer-events: auto;
        scrollbar-width: thin;
        scrollbar-color: rgba(61, 52, 39, 0.25) transparent;
      }
    }

    /* 宽容器（≥39.7rem ≈ 带标签内容宽）：按钮显示简短文本 */
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

    /* 速率按钮值：等宽数字防切换抖动；标签/字号与其他按钮一致（不加粗） */
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

    /* 透明效果在卡片本体：半透明白 + 自身毛玻璃，overlay 不参与 */
    .win-card {
      width: 100%;
      max-width: 22.5rem;
      margin: auto;
      padding: 1.875rem 1.875rem 1.625rem;
      text-align: center;
      background: rgba(255, 252, 245, 0.82);
      backdrop-filter: blur(0.5rem);
      -webkit-backdrop-filter: blur(0.5rem);
      border: 1px solid rgba(255, 255, 255, 0.7);
      border-radius: 1.625rem;
      corner-shape: squircle;
      box-shadow: 0 1.5rem 3.75rem rgba(61, 52, 39, 0.22);
      animation: pop 340ms cubic-bezier(0.3, 1.35, 0.5, 1);
    }

    .win-card h2 {
      margin: 0 0 0.5rem;
      font-size: 1.625rem;
      font-weight: 700;
      letter-spacing: -0.01em;
    }

    .win-card .desc {
      margin: 0 0 1.375rem;
      font-size: 0.875rem;
      line-height: 1.7;
      color: var(--ink-soft);
    }

    /* 耗时块：暖色底卡 + 竖排三行（合计/用时/额外）利用竖向空间；间距与文案/按钮统一（1.375rem） */
    .win-card .stats {
      margin: 0 0 1.375rem;
      padding: 0.875rem 1rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.375rem;
      font-variant-numeric: tabular-nums;
      color: var(--ink);
      background: rgba(255, 237, 209, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.55);
      border-radius: 0.875rem;
      corner-shape: squircle;
    }

    .win-card .stats .total {
      font-size: 1.375rem;
      font-weight: 700;
      letter-spacing: 0.01em;
    }

    .win-card .stats .line {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--ink-soft);
      white-space: nowrap;
    }

    .win-card .stats .extra {
      font-size: 0.75rem;
    }

    /* 本关最佳 / 新纪录：绿色强调（与游戏目标色一致） */
    .win-card .stats .record {
      color: var(--goal);
      font-weight: 600;
    }

    .win-card .row {
      display: flex;
      gap: 0.625rem;
      justify-content: center;
    }

    /* 主按钮行与下方次按钮行之间留出间距（原两行紧贴） */
    .win-card .row + .row {
      margin-top: 0.75rem;
    }

    /* 主按钮单独一行居中：横向拉伸到 15rem 封顶，观感上是卡片主 CTA */
    .win-card .row .next {
      flex: 1;
      max-width: 15rem;
    }

    .win-card button {
      padding: 0.6875rem 1.375rem;
      font-size: 0.875rem;
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
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-app': SfApp
  }
}
