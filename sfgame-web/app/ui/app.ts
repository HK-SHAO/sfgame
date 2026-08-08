import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'
import { keyed } from 'lit/directives/keyed.js'
import { fb } from '../core/feedback'
import { LEVELS, LEVEL_GROUPS, nextInGroup, solutionsFor } from '../game/levels'
import { progress } from '../game/progress'
import { SfGame } from './sf-game'
import type { SfHud } from './hud'
import { DevTools } from '../dev/devtools'
import '../dev/dev-menu'
import './storage-view'
import './win-overlay'
import './title-screen'
import './hud'
import './prewarm'
import { prewarm, prewarmPassed } from './prewarm'
import { urlState } from '../game/state'
import { screenFromUrl, type Screen, type ScreenState } from '../game/screen'
import type { HudState, LevelDef, SourcePlacement } from '../game/types'
import type { SourceKind } from '../sim/types'
import { boxReset } from './shared-styles'

const FIRST_LEVEL = LEVELS[0]

// HUD 初始态（初始化与换关重置共用；容错：LEVELS 全挂时预算以 0 兜底，不得再抛）
const defaultHud = (level: LevelDef | undefined): HudState => ({
  phase: 'playing',
  hotLeft: level?.budget.hot ?? 0,
  coldLeft: level?.budget.cold ?? 0,
  time: 0,
  extra: 0,
  sources: 0,
  paused: false,
})

@customElement('sf-app')
export class SfApp extends LitElement {
  @state() private screen: Screen = 'title'
  @state() private activeLevel: LevelDef = FIRST_LEVEL
  // 主页选项卡：纯本地 UI 态，不进 URL
  @state() private activeGroup = LEVEL_GROUPS[0]?.name ?? ''
  @state() private initialSources: SourcePlacement[] = []
  @state() private hud: HudState = defaultHud(FIRST_LEVEL)
  @state() private muted = fb.muted
  private winRank = -1
  @state() private rate = 1
  @state() private dev = urlState.get('dev')
  // 面板由 app 持有：sf-game 重建不销毁
  private devTools: DevTools | null = null
  private get speedSteps(): number[] {
    return this.dev ? [1, 2, 4, 8, 16, 0.5] : [1, 2, 4, 0.5]
  }

  @query('sf-game') private gameEl!: SfGame
  @query('sf-hud') private hudEl!: SfHud

  constructor() {
    super()
    fb.unlock()
    // 初始加载与外部变化允许脏 lv 净化；本地写路径不净化（见 screen.ts cleanup 注释）
    this.applyScreen(screenFromUrl(true))
    urlState.onChange('lv', () => this.applyScreen(screenFromUrl(true)))
    urlState.onChange('v', () => this.applyScreen(screenFromUrl(true)))
    urlState.onChange('src', (v) => {
      this.gameEl?.applySources(v)
      fb.uiClick()
    })
  }

  override disconnectedCallback() {
    this.devTools?.destroy()
    this.devTools = null
    super.disconnectedCallback()
  }

  // dev 覆写重建 sf-game 时面板不销毁：编辑器状态延续，便于连续迭代
  private syncDevTools() {
    if (this.screen === 'game' && this.dev) {
      if (!this.devTools) this.devTools = new DevTools({ onApply: this.onDevOverride })
    } else if (this.devTools) {
      this.devTools.destroy()
      this.devTools = null
    }
  }

  // dev 覆写生效：内联关卡文本压入 lv（编辑器已校验），清 src（浏览器返回即复原）
  private onDevOverride = (text: string) => {
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
    this.hud = defaultHud(level)
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
    // 预热/运行时校验未过不放行进关（校验失败时重弹警告卡）
    if (!prewarmPassed()) {
      prewarm.notifyFailure()
      return
    }
    fb.uiEnter()
    urlState.set('lv', id)
    urlState.clear('src')
    this.applyScreen(screenFromUrl())
  }

  private playNext() {
    const next = nextInGroup(this.activeLevel.id)
    if (next === undefined) return
    fb.uiEnter()
    // 同屏换关（screen 不变）：willUpdate 检测 activeLevel 变化重置 HUD，防上局 win 卡闪现
    urlState.set('lv', next)
    urlState.clear('src')
    this.applyScreen(screenFromUrl())
  }

  private goBack() {
    fb.uiBack()
    // 仅应用内导航（pushState 带 sf 标记）才回退上一页；直达链接/外部进入回首页
    if (window.history.state && window.history.state.sf) window.history.back()
    else this.backToTitle()
  }

  private backToTitle() {
    fb.uiBack()
    urlState.clear('lv')
    urlState.clear('src')
    urlState.clear('v')
    this.applyScreen(screenFromUrl())
  }

  private openStorage() {
    fb.uiEnter()
    urlState.set('v', 'storage')
    this.applyScreen(screenFromUrl())
  }

  private openDev() {
    fb.uiEnter()
    urlState.set('v', 'dev')
    this.applyScreen(screenFromUrl())
  }

  // dev 模式：关卡项上的参考解按钮——直达该关第一个注册解的摆法（省掉解法参考页）
  private openSolution(level: LevelDef) {
    const sol = solutionsFor(level.id)[0]
    if (!sol) return
    if (!prewarmPassed()) {
      prewarm.notifyFailure()
      return
    }
    fb.uiEnter()
    urlState.set('lv', level.id)
    urlState.set('src', sol.sources)
    urlState.clear('v')
    this.applyScreen(screenFromUrl())
  }

  // replace：切换不进历史（后退不会"撤销切换"）
  private toggleDev(e: CustomEvent<boolean>) {
    this.dev = e.detail
    urlState.set('dev', e.detail, { replace: true })
    fb.uiClick()
  }

  private restart() {
    fb.uiReset()
    this.gameEl?.restart()
  }

  private toggleSound() {
    this.muted = fb.toggleMuted()
    if (!this.muted) fb.uiClick()
  }

  private cycleSpeed() {
    const steps = this.speedSteps
    this.rate = steps[(steps.indexOf(this.rate) - 1 + steps.length) % steps.length]
    fb.uiClick()
  }

  private onGroup(e: CustomEvent<string>) {
    this.activeGroup = e.detail
    fb.uiClick()
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
    this.hudEl?.deny(e.detail)
  }

  private onSourcesChange(e: CustomEvent<SourcePlacement[]>) {
    if (e.detail.length === 0) urlState.clear('src')
    else urlState.set('src', e.detail)
  }

  protected override render() {
    let content: TemplateResult
    if (this.screen === 'game') content = this.renderGame()
    else if (this.screen === 'dev') {
      content = html`<sf-dev-menu
        .dev=${this.dev}
        @back=${this.goBack}
        @open-storage=${this.openStorage}
        @toggle-dev=${this.toggleDev}
      ></sf-dev-menu>`
    } else if (this.screen === 'storage') {
      content = html`<sf-storage @back=${this.goBack}></sf-storage>`
    } else {
      content = html`<sf-title-screen
        .dev=${this.dev}
        .activeGroup=${this.activeGroup}
        @group=${this.onGroup}
        @start=${(e: CustomEvent<number>) => this.startGame(e.detail)}
        @solution=${(e: CustomEvent<LevelDef>) => this.openSolution(e.detail)}
        @dev-page=${this.openDev}
      ></sf-title-screen>`
    }
    // 预热模块全自治（流水线+校验+状态 UI）：app 只挂载，不感知内部步骤
    return html`${content}<sf-prewarm></sf-prewarm>`
  }

  private renderGame() {
    const won = this.hud.phase === 'won'
    const bestTotal = won ? progress.best(this.activeLevel.id)[0]?.total : undefined
    const hasNext = nextInGroup(this.activeLevel.id) !== undefined
    return html`
      <main class="game">
        ${keyed(
          // keyed 按对象身份重建：关卡内容变化时必须重建 sf-game
          this.activeLevel,
          // 事件名用字面量：Lit 模板不支持动态事件名（@${expr} 静默失效）；协议定义见 sf-game.ts 的 HUD_CHANGE/DENY/SRC_CHANGE
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

        <sf-hud
          .hud=${this.hud}
          .muted=${this.muted}
          .rate=${this.rate}
          @back=${this.backToTitle}
          @pause=${() => this.gameEl?.togglePause()}
          @speed=${this.cycleSpeed}
          @restart=${this.restart}
          @sound=${this.toggleSound}
        ></sf-hud>

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
        position: relative;
        height: 100svh;
        height: 100dvh;
        overflow: hidden;
        color: var(--ink);
        container-type: inline-size;
        /* 祖先 touch-action 约束全部后代：禁 iOS 双击按钮放大（视口 user-scalable=no 在开启辅助放大时被忽略）；
           画布自身 touch-action:none 取更严交集，拖尾/手势不受影响 */
        touch-action: manipulation;
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

  `,
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-app': SfApp
  }
}
