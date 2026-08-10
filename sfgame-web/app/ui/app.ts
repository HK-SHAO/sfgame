import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'
import { keyed } from 'lit/directives/keyed.js'
import { fb } from '../core/feedback'
import { bgm } from '../core/bgm'
import { LEVELS, LEVEL_GROUPS, nextLevel, levelHash } from '../game/levels'
import { progress } from '../game/progress'
import { SfGame, type DenyDetail } from './sf-game'
import type { SfHud } from './hud'
import { DevTools } from '../dev/devtools'
import '../dev/dev-menu'
import './storage-view'
import './win-overlay'
import './title-screen'
import './about-screen'
import './hud'
import { urlState } from '../game/state'
import { screenFromUrl, type Screen, type ScreenState } from '../game/screen'
import type { HudState, LevelDef, SourcePlacement } from '../game/types'
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
    urlState.onChange('s', (v) => {
      this.gameEl?.applySources(v)
      fb.uiClick()
    })
  }

  override disconnectedCallback() {
    this.devTools?.destroy()
    this.devTools = null
    super.disconnectedCallback()
  }

  // dev 覆写重建 sf-game 时面板不销毁：编辑器状态延续
  private syncDevTools() {
    if (this.screen === 'game' && this.dev) {
      if (!this.devTools) this.devTools = new DevTools({ onApply: this.onDevOverride })
    } else if (this.devTools) {
      this.devTools.destroy()
      this.devTools = null
    }
  }

  // dev 覆写生效：内联关卡文本压入 lv（编辑器已校验）；旧摆法不随关卡继承
  private onDevOverride = (text: string) => {
    urlState.set('lv', text)
    urlState.clear('s')
    this.applyScreen(screenFromUrl())
  }

  // URL 派生单入口：本地写（写读分离不回调）与外部变化（onChange）都经此应用，派生逻辑唯一在 game/screen.ts
  private applyScreen(s: ScreenState) {
    this.screen = s.screen
    // 非 game 屏保留旧关卡：渲染不依赖，且 keyed(activeLevel) 换关重建语义由引用变化驱动
    if (s.level) this.activeLevel = s.level
    this.initialSources = s.sources
    // 退出关卡屏（主页/存储/dev）速率归 1：倍率只在关卡内有意义，BGM 播放速率同步恢复
    if (s.screen !== 'game' && this.rate !== 1) {
      this.rate = 1
      bgm.setRate(1)
    }
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

  // 渲染后挂载 dev 面板（hud 已就绪）：appendChild 幂等，hud 重建后自动重挂
  protected override updated() {
    this.devTools?.mount(this.hudEl)
  }

  private startGame(id: number) {
    fb.uiEnter()
    urlState.set('lv', id)
    urlState.clear('s')
    this.applyScreen(screenFromUrl())
  }

  private playNext() {
    const next = nextLevel(this.activeLevel.id)
    if (next === undefined) return
    fb.uiEnter()
    // 同屏换关（screen 不变）：willUpdate 检测 activeLevel 变化重置 HUD，防上局 win 卡闪现
    urlState.set('lv', next)
    urlState.clear('s')
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
    urlState.clear('s')
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

  private openAbout() {
    fb.uiEnter()
    urlState.set('v', 'about')
    this.applyScreen(screenFromUrl())
  }

  // replace：切换不进历史（后退不会"撤销切换"）；关闭即清参——dev=0 不落 URL（参数存在即暴露开发者模式入口）
  private toggleDev(e: CustomEvent<boolean>) {
    this.dev = e.detail
    if (e.detail) urlState.set('dev', true, { replace: true })
    else urlState.clear('dev', { replace: true })
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
    bgm.setRate(this.rate)
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
    const h = levelHash(urlState.get('lv'))
    if (!h) return
    this.winRank = progress.record(h, {
      time: this.hud.time,
      extra: this.hud.extra,
    })
  }

  private onDeny(e: CustomEvent<DenyDetail>) {
    // chip 抖动（哪个道具不足）由 hud 呈现，全屏波纹已在 sf-game 层播放
    this.hudEl?.deny(e.detail.kind)
  }

  private onSourcesChange(e: CustomEvent<SourcePlacement[]>) {
    if (e.detail.length === 0) urlState.clear('s')
    else urlState.set('s', e.detail)
  }

  protected override render() {
    let content: TemplateResult
    if (this.screen === 'game') content = this.renderGame()
    else if (this.screen === 'dev') {
      // dev 页返回固定回主页并保留当前 dev：history.back 会穿越 replace 之前的旧条目（携带旧 dev 值，已关闭的开发者模式会"复活"）
      content = html`<sf-dev-menu
        .dev=${this.dev}
        @back=${this.backToTitle}
        @open-storage=${this.openStorage}
        @toggle-dev=${this.toggleDev}
      ></sf-dev-menu>`
    } else if (this.screen === 'storage') {
      content = html`<sf-storage @back=${this.goBack}></sf-storage>`
    } else if (this.screen === 'about') {
      content = html`<sf-about @back=${this.goBack}></sf-about>`
    } else {
      content = html`<sf-title-screen
        .dev=${this.dev}
        .activeGroup=${this.activeGroup}
        @group=${this.onGroup}
        @start=${(e: CustomEvent<number>) => this.startGame(e.detail)}
        @dev-page=${this.openDev}
        @about=${this.openAbout}
      ></sf-title-screen>`
    }
    return content
  }

  private renderGame() {
    const won = this.hud.phase === 'won'
    const h = levelHash(urlState.get('lv'))
    const bestTotal = won && h ? progress.best(h)?.total : undefined
    const hasNext = nextLevel(this.activeLevel.id) !== undefined
    return html`
      <main class="game">
        ${keyed(
          // keyed 按对象身份重建：关卡内容变化时必须重建 sf-game
          this.activeLevel,
          // 事件名用字面量：Lit 模板不支持动态事件名（@${expr} 静默失效）
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
