import { LitElement, css, html, nothing, type PropertyValues } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'
import { keyed } from 'lit/directives/keyed.js'
import { fb } from '../core/feedback.ts'
import { bgm } from '../core/bgm.ts'
import { analytics } from '../core/analytics.ts'
import { LEVELS, LEVEL_GROUPS, nextLevel, levelHash } from '../game/levels.ts'
import { progress } from '../game/progress.ts'
import { SfGame, type DenyDetail, type UnsupportedDetail } from './sf-game.ts'
import type { SfHud } from './hud.ts'
import { DevTools } from '../dev/devtools.ts'
import './unsupported'
import '../dev/dev-menu'
import './storage-view'
import './win-overlay'
import './title-screen'
import './about-screen'
import './hud.ts'
import { urlState, type AppView } from '../game/state.ts'
import { loadDev, saveDev } from '../game/dev-mode.ts'
import { screenFromUrl, type Screen, type ScreenState } from '../game/screen.ts'
import type { HudState, LevelDef, SourcePlacement } from '../game/types.ts'
import { setupKeys } from './keys.ts'
import { boxReset } from './shared-styles.ts'

const FIRST_LEVEL = LEVELS[0]

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
  @state() private activeGroup = LEVEL_GROUPS[0]?.name ?? ''
  @state() private initialSources: SourcePlacement[] = []
  @state() private hud: HudState = defaultHud(FIRST_LEVEL)
  @state() private muted = fb.muted
  @state() private rate = 1
  @state() private persistedDev = loadDev()
  @state() private urlDev = urlState.get('dev')
  private winRank = -1
  private devTools: DevTools | null = null
  private disposeKeys: (() => void) | null = null
  private urlSubs: (() => void)[] = []
  private activeLevelHash = ''
  private lastStartLevel: LevelDef | null = null

  @query('sf-game') private gameEl!: SfGame
  @query('sf-hud') private hudEl!: SfHud

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

  private get dev(): boolean {
    return this.persistedDev || (this.screen === 'game' && this.urlDev)
  }

  private get speedSteps(): number[] {
    return this.dev ? [1, 2, 4, 8, 16, 0.5] : [1, 2, 4, 0.5]
  }

  constructor() {
    super()
    fb.unlock()
    this.applyScreen(screenFromUrl(true))
  }

  override connectedCallback() {
    super.connectedCallback()
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
    if (this.screen === 'game' && (changed.has('screen') || changed.has('activeLevel'))) {
      this.resetHud(this.activeLevel)
    }
  }

  protected override updated() {
    this.devTools?.mount(this.hudEl)
  }

  private bindUrlState() {
    this.disposeUrlState()
    this.urlSubs = [
      urlState.onChange('lv', () => this.applyScreen(screenFromUrl(true))),
      urlState.onChange('v', () => this.applyScreen(screenFromUrl(true))),
      urlState.onChange('s', (v) => {
        this.gameEl?.applySources(v)
        fb.uiClick()
      }),
      urlState.onChange('dev', (v) => {
        this.urlDev = v
      }),
    ]
  }

  private disposeUrlState() {
    for (const off of this.urlSubs) off()
    this.urlSubs = []
  }

  private applyScreen(s: ScreenState) {
    this.screen = s.screen
    if (s.level) {
      this.activeLevel = s.level
      this.activeLevelHash = levelHash(urlState.get('lv')) ?? ''
    }
    if (s.screen === 'game' && s.level && s.level !== this.lastStartLevel) {
      this.lastStartLevel = s.level
      this.emitLevelStart(s.level)
    }
    this.initialSources = s.sources
    if (s.screen !== 'game' && this.rate !== 1) {
      this.rate = 1
      bgm.setRate(1)
    }
  }

  private enterLevel(id: string) {
    urlState.set('lv', { id })
    urlState.clear('s')
    this.applyScreen(screenFromUrl())
  }

  private startGame(id: string) {
    fb.uiEnter()
    this.enterLevel(id)
  }

  private onStart(e: CustomEvent<string>) {
    this.startGame(e.detail)
  }

  private onCreate() {
    fb.uiEnter()
    this.urlDev = true
    urlState.set('lv', { id: FIRST_LEVEL.id })
    urlState.clear('s')
    urlState.set('dev', true)
    this.applyScreen(screenFromUrl())
  }

  private playNext() {
    const next = nextLevel(this.activeLevel.id)
    if (next === undefined) return
    fb.uiEnter()
    this.enterLevel(next)
  }

  private hasSfHistory(): boolean {
    return !!window.history.state && !!(window.history.state as { sf?: boolean }).sf
  }

  private goBack() {
    fb.uiBack()
    if (this.hasSfHistory()) window.history.back()
    else this.backToTitle()
  }

  private backToTitle() {
    fb.uiBack()
    urlState.clear('lv')
    urlState.clear('s')
    urlState.clear('v')
    this.urlDev = false
    urlState.clear('dev')
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

  private toggleDev(e: CustomEvent<boolean>) {
    this.persistedDev = e.detail
    saveDev(e.detail)
    fb.uiClick()
  }

  private onDevOverride = (text: string) => {
    urlState.set('lv', { json: text })
    urlState.clear('s')
    this.applyScreen(screenFromUrl())
  }

  private resetHud(level: LevelDef) {
    this.hud = defaultHud(level)
    this.winRank = -1
  }

  private cycleSpeed(dir: 1 | -1 = -1) {
    const steps = this.speedSteps
    this.rate = steps[(steps.indexOf(this.rate) + dir + steps.length) % steps.length]
    bgm.setRate(this.rate)
    fb.uiClick()
  }

  private undoMove() {
    if (this.hasSfHistory()) window.history.back()
  }

  private redoMove() {
    if (this.hasSfHistory()) window.history.forward()
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

  private onDeny(e: CustomEvent<DenyDetail>) {
    this.hudEl?.deny(e.detail.kind)
  }

  private onSourcesChange(e: CustomEvent<SourcePlacement[]>) {
    if (e.detail.length === 0) urlState.clear('s')
    else urlState.set('s', e.detail)
  }

  private onUnsupported(e: CustomEvent<UnsupportedDetail>) {
    const el = document.createElement('sf-unsupported') as HTMLElement & { reason: string }
    el.reason = e.detail?.reason ?? 'webgl'
    document.body.replaceChildren(el)
  }

  private recordWin() {
    const lv = urlState.get('lv')
    const h = levelHash(lv)
    if (!h) return
    this.winRank = progress.record(h, {
      time: this.hud.time,
      extra: this.hud.extra,
    })
    if (lv !== null && 'id' in lv) this.emitLevelComplete(this.winRank === 0)
  }

  private emitLevelStart(level: LevelDef) {
    if (this.devTools) return
    analytics.emit({
      type: 'level_start',
      payload: { levelId: level.id, levelName: level.name },
    })
  }

  private emitLevelComplete(newRecord: boolean) {
    if (this.devTools) return
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

  private syncDevTools() {
    if (this.screen === 'game' && this.dev) {
      if (!this.devTools) this.devTools = new DevTools({ onApply: this.onDevOverride })
    } else if (this.devTools) {
      this.devTools.destroy()
      this.devTools = null
    }
  }

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
      @create=${this.onCreate}
      @dev-page=${this.openDev}
      @about=${this.openAbout}
    ></sf-title-screen>`
  }

  private renderDev() {
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
            @unsupported=${this.onUnsupported}
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
      }

      .game {
        position: relative;
        height: 100%;
        background: var(--paper);
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
