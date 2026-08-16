import { LitElement, css, html, type PropertyValues } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import type { SourceKind } from '../sim/types.ts'
import type { HudState, LevelDef, SourcePlacement } from '../game/types.ts'
import type { PerfRecorder } from '../dev/devtools.ts'
import { GameController } from './controller.ts'
import { levelNo } from '../game/levels.ts'
import './status-bar'
import { boxReset, reduceMotion } from './shared-styles.ts'

export const HUD_CHANGE = 'hudchange'
export const DENY = 'deny'
export const SRC_CHANGE = 'sourceschange'
export const UNSUPPORTED = 'unsupported'
export interface UnsupportedDetail {
  reason: 'webgl' | 'fatal'
}
export interface DenyDetail {
  kind: SourceKind
  clientX: number
  clientY: number
}

@customElement('sf-game')
export class SfGame extends LitElement {
  @property({ attribute: false }) level: LevelDef | null = null
  @property({ attribute: false }) initialSources: SourcePlacement[] = []
  @property({ attribute: false }) rate = 1
  @property({ attribute: false }) devTools: PerfRecorder | null = null

  @state() private statusTime = 0
  @state() private statusPenalty = 0
  private cachedNo = 0
  private cachedName = ''

  @query('canvas') private canvas!: HTMLCanvasElement

  @query('.deny-ring') private denyRing!: HTMLDivElement

  private controller: GameController | null = null

  private showDeny(clientX: number, clientY: number) {
    const host = this.getBoundingClientRect()
    this.denyRing.style.left = `${clientX - host.left}px`
    this.denyRing.style.top = `${clientY - host.top}px`
    this.denyRing.style.visibility = 'visible'
    this.denyRing.animate(
      [
        { transform: 'translate(-50%, -50%) scale(0.35)', opacity: 0.85 },
        { transform: 'translate(-50%, -50%) scale(1.15)', opacity: 0 },
      ],
      { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.4, 1)' },
    ).onfinish = () => {
      this.denyRing.style.visibility = 'hidden'
    }
  }

  protected override firstUpdated() {
    if (!this.isConnected || !this.level) return
    this.controller = new GameController(this.canvas, this.level, {
      onHud: (s) => this.dispatchEvent(new CustomEvent<HudState>(HUD_CHANGE, { detail: s })),
      onDeny: (kind, clientX, clientY) => {
        this.showDeny(clientX, clientY)
        this.dispatchEvent(new CustomEvent<DenyDetail>(DENY, { detail: { kind, clientX, clientY } }))
      },
      onSources: (s) =>
        this.dispatchEvent(new CustomEvent<SourcePlacement[]>(SRC_CHANGE, { detail: s })),
      onStatus: (time, extra) => {
        this.statusTime = time
        this.statusPenalty = extra
      },
      onFatal: () =>
        this.dispatchEvent(new CustomEvent<UnsupportedDetail>(UNSUPPORTED, { detail: { reason: 'fatal' } })),
    }, this, this.devTools)
    if (!this.controller.renderable) {
      this.dispatchEvent(new CustomEvent<UnsupportedDetail>(UNSUPPORTED, { detail: { reason: 'webgl' } }))
      return
    }
    void this.updateComplete.then(() => {
      this.controller?.applySources(this.initialSources, true)
      this.controller?.start()
    })
  }

  protected override willUpdate(changed: PropertyValues) {
    if (changed.has('level')) {
      this.cachedNo = levelNo(this.level?.id ?? '')
      this.cachedName = this.level?.name ?? ''
    }
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
      <div class="deny-ring" aria-hidden="true"></div>
      <sf-status
        .levelNo=${this.cachedNo}
        .levelName=${this.cachedName}
        .time=${this.statusTime}
        .penalty=${this.statusPenalty}
      ></sf-status>
    `
  }

  static styles = [
    boxReset,
    reduceMotion,
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
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
        background: var(--bg-top);
      }

      .deny-ring {
        position: absolute;
        left: 0;
        top: 0;
        width: 2.75rem;
        height: 2.75rem;
        border-radius: 50%;
        border: 2px solid var(--hot);
        pointer-events: none;
        visibility: hidden;
        transform: translate(-50%, -50%);
      }
    `,
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-game': SfGame
  }
}
