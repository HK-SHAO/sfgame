import { LitElement, css, html, nothing, type PropertyValues } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'
import { keyed } from 'lit/directives/keyed.js'
import { fb } from '../core/feedback.ts'
import { bgm } from '../core/bgm.ts'
import { analytics } from '../core/analytics.ts'
import { LEVELS, LEVEL_GROUPS, nextLevel, levelHash } from '../game/levels.ts'
import { progress } from '../game/progress.ts'
import { SfGame, type DenyDetail } from './sf-game.ts'
import type { SfHud } from './hud.ts'
import { DevTools } from '../dev/devtools.ts'
import '../dev/dev-menu'
import './storage-view'
import './win-overlay'
import './title-screen'
import './about-screen'
import './hud.ts'
import { urlState, type AppView } from '../game/state.ts'
import { screenFromUrl, type Screen, type ScreenState } from '../game/screen.ts'
import type { HudState, LevelDef, SourcePlacement } from '../game/types.ts'
import { setupKeys } from './keys.ts'
import { boxReset } from './shared-styles.ts'

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
  // ===== 状态字段 =====
  @state() private screen: Screen = 'title'
  @state() private activeLevel: LevelDef = FIRST_LEVEL
  // 主页选项卡：纯本地 UI 态，不进 URL
  @state() private activeGroup = LEVEL_GROUPS[0]?.name ?? ''
  @state() private initialSources: SourcePlacement[] = []
  @state() private hud: HudState = defaultHud(FIRST_LEVEL)
  @state() private muted = fb.muted
  @state() private rate = 1
  @state() private dev = urlState.get('dev')
  private winRank = -1
  // 面板由 app 持有：sf-game 重建不销毁
  private devTools: DevTools | null = null
  private disposeKeys: (() => void) | null = null
  // urlState 订阅退订函数（connectedCallback 注册、disconnectedCallback 对称退订）
  private urlSubs: (() => void)[] = []
  // 关卡内容 hash 缓存：renderGame 每渲染调用 levelHash 会对全文重算 FNV，这里随关卡变化算一次
  private activeLevelHash = ''

  @query('sf-game') private gameEl!: SfGame
  @query('sf-hud') private hudEl!: SfHud

  // ===== 统一语义动作 =====
  // hud 模板与键盘装配共用（行为唯一来源）：hud 派发的事件只做转发，不重定义动作
  private actions = {
    pause: () => this.gameEl?.togglePause(),
    restart: () => {
      fb.uiReset()
      this.gameEl?.restart()
    },
    mute: () => {
      this.muted = fb.toggleMuted()
      if (!this.muted) fb.uiClick()
    },
    back: () => this.backToTitle(),
    speedDown: () => this.cycleSpeed(-1),
    speedUp: () => this.cycleSpeed(1),
  }

  private get speedSteps(): number[] {
    return this.dev ? [1, 2, 4, 8, 16, 0.5] : [1, 2, 4, 0.5]
  }

  // ===== 生命周期 =====
  constructor() {
    super()
    fb.unlock()
    // 初始加载与外部变化允许脏 lv 净化；本地写路径不净化（见 screen.ts cleanup 注释）
    this.applyScreen(screenFromUrl(true))
  }

  override connectedCallback() {
    super.connectedCallback()
    // 挂载时注册（幂等：先退旧再注册，元素移动/重挂不累积）；constructor 注册在卸载重挂场景会永久丢失
    this.bindUrlState()
    this.bindKeys()
  }

  override disconnectedCallback() {
    this.disposeUrlState()
    this.disposeKeys?.()
    this.disposeKeys = null
    this.devTools?.destroy()
    this.devTools = null
    super.disconnectedCallback()
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

  // 渲染后挂载 dev 面板（hud 已就绪）：mount 内部守卫跳过重复挂载，hud 重建后自动重挂
  protected override updated() {
    this.devTools?.mount(this.hudEl)
  }

  // ===== URL 导航 =====
  private bindUrlState() {
    this.disposeUrlState()
    this.urlSubs = [
      urlState.onChange('lv', () => this.applyScreen(screenFromUrl(true))),
      urlState.onChange('v', () => this.applyScreen(screenFromUrl(true))),
      urlState.onChange('s', (v) => {
        this.gameEl?.applySources(v)
        fb.uiClick()
      }),
    ]
  }

  private disposeUrlState() {
    for (const off of this.urlSubs) off()
    this.urlSubs = []
  }

  // URL 派生单入口：本地写（写读分离不回调）与外部变化（onChange）都经此应用，派生逻辑唯一在 game/screen.ts
  private applyScreen(s: ScreenState) {
    this.screen = s.screen
    // 非 game 屏保留旧关卡：渲染不依赖，且 keyed(activeLevel) 换关重建语义由引用变化驱动
    if (s.level) {
      this.activeLevel = s.level
      this.activeLevelHash = levelHash(urlState.get('lv')) ?? ''
    }
    this.initialSources = s.sources
    // 退出关卡屏（主页/存储/dev）速率归 1：倍率只在关卡内有意义，BGM 播放速率同步恢复
    if (s.screen !== 'game' && this.rate !== 1) {
      this.rate = 1
      bgm.setRate(1)
    }
  }

  // 进关共用：写 lv + 清旧摆法 + 应用 URL 派生 + 上报关卡开始；同屏换关时 willUpdate 检测 activeLevel 变化重置 HUD
  private enterLevel(id: string) {
    urlState.set('lv', { id })
    urlState.clear('s')
    this.applyScreen(screenFromUrl())
    this.emitLevelStart(this.activeLevel)
  }

  private startGame(id: string) {
    fb.uiEnter()
    this.enterLevel(id)
  }

  private onStart(e: CustomEvent<string>) {
    this.startGame(e.detail)
  }

  private playNext() {
    const next = nextLevel(this.activeLevel.id)
    if (next === undefined) return
    fb.uiEnter()
    this.enterLevel(next)
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

  private openView(view: AppView) {
    fb.uiEnter()
    urlState.set('v', view)
    this.applyScreen(screenFromUrl())
  }

  private openStorage() {
    this.openView('storage')
  }

  private openDev() {
    this.openView('dev')
  }

  private openAbout() {
    this.openView('about')
  }

  // replace：切换不进历史（后退不会"撤销切换"）；关闭即清参——dev=0 不落 URL（参数存在即暴露开发者模式入口）
  private toggleDev(e: CustomEvent<boolean>) {
    this.dev = e.detail
    if (e.detail) urlState.set('dev', true, { replace: true })
    else urlState.clear('dev', { replace: true })
    fb.uiClick()
  }

  // dev 覆写生效：内联关卡文本压入 lv（编辑器已校验）；旧摆法不随关卡继承
  private onDevOverride = (text: string) => {
    urlState.set('lv', { json: text })
    urlState.clear('s')
    this.applyScreen(screenFromUrl())
  }

  private resetHud(level: LevelDef) {
    this.hud = defaultHud(level)
    this.winRank = -1
  }

  // ===== 会话动作 =====
  private cycleSpeed(dir: 1 | -1 = -1) {
    const steps = this.speedSteps
    this.rate = steps[(steps.indexOf(this.rate) + dir + steps.length) % steps.length]
    bgm.setRate(this.rate)
    fb.uiClick()
  }

  // 撤销/重做 = 浏览器历史导航（全局语义，如浏览器左右箭头）：每次应用内状态变更都是带 sf 标记的 pushState 条目，
  // popstate 应用路径由 urlState 写读分离保证不回写；输入框内由原生文本撤销优先，keys 层已过滤
  private undoMove() {
    window.history.back()
  }

  private redoMove() {
    window.history.forward()
  }

  // ===== hud 事件处理器 =====
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

  private onDeny(e: CustomEvent<DenyDetail>) {
    // chip 抖动（哪个道具不足）由 hud 呈现，全屏波纹已在 sf-game 层播放
    this.hudEl?.deny(e.detail.kind)
  }

  private onSourcesChange(e: CustomEvent<SourcePlacement[]>) {
    if (e.detail.length === 0) urlState.clear('s')
    else urlState.set('s', e.detail)
  }

  private recordWin() {
    const lv = urlState.get('lv')
    const h = levelHash(lv)
    if (!h) return
    this.winRank = progress.record(h, {
      time: this.hud.time,
      extra: this.hud.extra,
    })
    // 正式数据排除内联关卡（dev 编辑器产物）：仅 id 形态（内置关卡）上报
    if (lv !== null && 'id' in lv) this.emitLevelComplete(this.winRank === 0)
  }

  // ===== 上报（语义事件：业务侧只发事件，传输由 main.ts 装配的适配器接管） =====
  private emitLevelStart(level: LevelDef) {
    analytics.emit({
      type: 'level_start',
      payload: { levelId: level.id, levelName: level.name },
    })
  }

  private emitLevelComplete(newRecord: boolean) {
    analytics.emit({
      type: 'level_complete',
      payload: {
        levelId: this.activeLevel.id,
        levelName: this.activeLevel.name,
        time: this.hud.time,
        extra: this.hud.extra,
        sources: this.hud.sources,
        totalTime: this.hud.time + this.hud.extra,
        newRecord,
      },
    })
  }

  // ===== dev 工具 =====
  // dev 覆写重建 sf-game 时面板不销毁：编辑器状态延续
  private syncDevTools() {
    if (this.screen === 'game' && this.dev) {
      if (!this.devTools) this.devTools = new DevTools({ onApply: this.onDevOverride })
    } else if (this.devTools) {
      this.devTools.destroy()
      this.devTools = null
    }
  }

  // ===== 键盘装配 =====
  private bindKeys() {
    this.disposeKeys?.()
    this.disposeKeys = setupKeys(
      {
        ...this.actions,
        undo: () => this.undoMove(),
        redo: () => this.redoMove(),
      },
      () => this.screen === 'game',
    )
  }

  // ===== 渲染 =====
  protected override render() {
    switch (this.screen) {
      case 'game':
        return this.renderGame()
      case 'dev':
        return this.renderDev()
      case 'storage':
        return this.renderStorage()
      case 'about':
        return this.renderAbout()
      default:
        return this.renderTitle()
    }
  }

  private renderTitle() {
    return html`<sf-title-screen
      .dev=${this.dev}
      .activeGroup=${this.activeGroup}
      @group=${this.onGroup}
      @start=${this.onStart}
      @dev-page=${this.openDev}
      @about=${this.openAbout}
    ></sf-title-screen>`
  }

  private renderDev() {
    // dev 页返回固定回主页并保留当前 dev：history.back 会穿越 replace 之前的旧条目（携带旧 dev 值，已关闭的开发者模式会"复活"）
    return html`<sf-dev-menu
      .dev=${this.dev}
      @back=${this.actions.back}
      @open-storage=${this.openStorage}
      @toggle-dev=${this.toggleDev}
    ></sf-dev-menu>`
  }

  private renderStorage() {
    return html`<sf-storage @back=${this.goBack}></sf-storage>`
  }

  private renderAbout() {
    return html`<sf-about @back=${this.goBack}></sf-about>`
  }

  private renderGame() {
    const won = this.hud.phase === 'won'
    const h = this.activeLevelHash
    const bestTotal = won && h ? progress.best(h)?.total : undefined
    const hasNext = nextLevel(this.activeLevel.id) !== undefined
    // keyed 按对象身份重建：关卡内容变化时必须重建 sf-game
    // 事件名用字面量：Lit 模板不支持动态事件名（@${expr} 静默失效）
    return html`
      <main class="game">
        ${keyed(
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

        <sf-hud
          .hud=${this.hud}
          .muted=${this.muted}
          .rate=${this.rate}
          @back=${this.actions.back}
          @pause=${this.actions.pause}
          @speed=${this.actions.speedDown}
          @restart=${this.actions.restart}
          @sound=${this.actions.mute}
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
              @replay=${this.actions.restart}
              @back=${this.actions.back}
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
