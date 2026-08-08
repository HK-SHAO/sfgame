import { LitElement, css, html, type PropertyValues } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import type { SourceKind } from '../sim/types'
import type { HudState, LevelDef, SourcePlacement } from '../game/types'
import type { PerfRecorder } from '../dev/devtools'
import { GameController } from './controller'
import './status-bar'
import { boxReset } from './shared-styles'

// 事件协议名：app.ts 模板与 dispatch 共用同一来源（跨组件协议名单一事实）
export const HUD_CHANGE = 'hudchange'
export const DENY = 'deny'
export const SRC_CHANGE = 'sourceschange'

// HUD 状态经事件派发；状态条由 onStatus 直推 @state（值不变短路零开销）。
// 两者都只能在更新周期外发生：start/applySources 内含同步 render（onStatus 直写）与事件派发，
// 须等 updateComplete（首轮 update 完成）后再启动，否则 firstUpdated 同步链内写 @state 触发 change-in-update
@customElement('sf-game')
export class SfGame extends LitElement {
  @property({ attribute: false }) level: LevelDef | null = null
  @property({ attribute: false }) initialSources: SourcePlacement[] = []
  @property({ attribute: false }) rate = 1
  @property({ attribute: false }) devTools: PerfRecorder | null = null

  // 状态条数据：controller 每帧经 onStatus 回调直推（rAF 内、更新周期外，无 change-in-update）
  @state() private statusTime = 0
  @state() private statusPenalty = 0

  @query('canvas') private canvas!: HTMLCanvasElement

  private controller: GameController | null = null

  protected override firstUpdated() {
    if (!this.isConnected || !this.level) return
    // canvas 是 shadow root 直接子节点，parentElement 恒为 null，须显式传宿主
    this.controller = new GameController(this.canvas, this.level, {
      onHud: (s) => this.dispatchEvent(new CustomEvent<HudState>(HUD_CHANGE, { detail: s })),
      onDeny: (kind) => this.dispatchEvent(new CustomEvent<SourceKind>(DENY, { detail: kind })),
      onSources: (s) =>
        this.dispatchEvent(new CustomEvent<SourcePlacement[]>(SRC_CHANGE, { detail: s })),
      onStatus: (time, extra) => {
        this.statusTime = time
        this.statusPenalty = extra
      },
    }, this, this.devTools)
    // 首轮 update 完成后再启动：start() 内 fit 会同步 render → onStatus 直写 @state，
    // 在 firstUpdated 同步链内值变化会触发 change-in-update（如 URL 带源直达时罚时 0→4）
    void this.updateComplete.then(() => {
      this.controller?.applySources(this.initialSources, true)
      this.controller?.start()
    })
  }

  protected override updated(changed: PropertyValues) {
    if (changed.has('rate')) this.controller?.setRate(this.rate)
  }

  override disconnectedCallback() {
    this.controller?.destroy()
    this.controller = null
    super.disconnectedCallback()
  }

  restart() {
    this.controller?.restart()
  }

  togglePause() {
    this.controller?.togglePause()
  }

  applySources(list: SourcePlacement[]) {
    this.controller?.applySources(list)
  }

  protected override render() {
    return html`
      <canvas role="img" aria-label="烧风：放置热源与冷源，用风把纸飞机送达目标"></canvas>
      <sf-status
        .levelId=${this.level?.id ?? 0}
        .levelName=${this.level?.name ?? ''}
        .time=${this.statusTime}
        .penalty=${this.statusPenalty}
      ></sf-status>
    `
  }

  static styles = [
    boxReset,
    css`
      :host {
        display: block;
        width: 100%;
        height: 100%;
        color: var(--ink);
      }

      canvas {
        width: 100%;
        height: 100%;
        display: block;
        touch-action: none;
        /* WebGL 兜底底色：缓冲未初始化时不黑屏 */
        background: #fff8ea;
      }
    `,
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-game': SfGame
  }
}
