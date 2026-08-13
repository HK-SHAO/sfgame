import { LitElement, css, html, type PropertyValues } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import type { SourceKind } from '../sim/types.ts'
import type { HudState, LevelDef, SourcePlacement } from '../game/types.ts'
import type { PerfRecorder } from '../dev/devtools.ts'
import { GameController } from './controller.ts'
import { levelNo } from '../game/levels.ts'
import './status-bar'
import { boxReset, reduceMotion } from './shared-styles.ts'

// 事件协议名：app.ts 模板与 dispatch 共用同一来源（跨组件协议名单一事实）
export const HUD_CHANGE = 'hudchange'
export const DENY = 'deny'
export const SRC_CHANGE = 'sourceschange'
export const UNSUPPORTED = 'unsupported'
export interface DenyDetail {
  kind: SourceKind
  clientX: number
  clientY: number
}

// HUD 经事件派发、状态条直推 @state：都须在更新周期外（start/applySources 内含同步 render 与事件派发），
// 否则 firstUpdated 同步链内写 @state 触发 change-in-update
@customElement('sf-game')
export class SfGame extends LitElement {
  @property({ attribute: false }) level: LevelDef | null = null
  @property({ attribute: false }) initialSources: SourcePlacement[] = []
  @property({ attribute: false }) rate = 1
  @property({ attribute: false }) devTools: PerfRecorder | null = null

  // 状态条数据：onStatus 每帧直推（rAF 内、更新周期外）
  @state() private statusTime = 0
  @state() private statusPenalty = 0

  @query('canvas') private canvas!: HTMLCanvasElement

  // 全屏 deny 波纹单节点（复用不重复创建）：覆盖画面任意失败位置（含 letterbox 带）
  @query('.deny-ring') private denyRing!: HTMLDivElement

  private controller: GameController | null = null

  // 波纹跟随点击：client 坐标 → 宿主相对坐标（单节点 animate 复用）
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
    // canvas 是 shadow root 直接子节点，parentElement 恒为 null，须显式传宿主
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
    }, this, this.devTools)
    // WebGL 不可用是持久条件：与 wasm 失败同策略明示无法运行，绝不带病盲玩（可写入通关记录的无声局）
    if (!this.controller.renderable) {
      this.dispatchEvent(new Event(UNSUPPORTED))
      return
    }
    // 首轮 update 完成后再启动：start 内 fit 同步 render → onStatus 直写 @state，
    // firstUpdated 链内值变触发 change-in-update（如 URL 带源直达罚时 0→4）
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
      <div class="deny-ring" aria-hidden="true"></div>
      <sf-status
        .levelNo=${levelNo(this.level?.id ?? '')}
        .levelName=${this.level?.name ?? ''}
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
        /* 画布区域禁止选择/长按系统菜单 */
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
        /* WebGL 兜底底色：缓冲未初始化时不黑屏 */
        background: #fff8ea;
      }

      /* 放置被拒波纹：单节点，不拦截指针 */
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
