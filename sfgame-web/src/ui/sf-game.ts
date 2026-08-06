import { LitElement, css, html, type PropertyValues } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import type { SourceKind } from '../sim/types'
import type { HudState, LevelDef, SourcePlacement } from '../game/types'
import type { DevTools } from '../dev/devtools'
import { GameController } from './controller'
import { boxReset } from './shared-styles'

export const HUD_CHANGE = 'hudchange'
export const DENY = 'deny'
export const SRC_CHANGE = 'sourceschange'

// HUD 状态经事件在更新周期外派发，避免 change-in-update 告警
@customElement('sf-game')
export class SfGame extends LitElement {
  @property({ attribute: false }) level: LevelDef | null = null
  @property({ attribute: false }) initialSources: SourcePlacement[] = []
  @property({ attribute: false }) rate = 1
  @property({ attribute: false }) devTools: DevTools | null = null

  private controller: GameController | null = null

  protected override firstUpdated() {
    if (!this.isConnected || !this.level) return
    const canvas = this.renderRoot.querySelector('canvas')
    if (!canvas) return
    // canvas 是 shadow root 直接子节点，parentElement 恒为 null，须显式传宿主
    this.controller = new GameController(canvas, this.level, {
      onHud: (s) => this.dispatchEvent(new CustomEvent<HudState>(HUD_CHANGE, { detail: s })),
      onDeny: (kind) => this.dispatchEvent(new CustomEvent<SourceKind>(DENY, { detail: kind })),
      onSources: (s) =>
        this.dispatchEvent(new CustomEvent<SourcePlacement[]>(SRC_CHANGE, { detail: s })),
    }, this, this.devTools)
    this.controller.applySources(this.initialSources, true)
    this.controller.start()
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
