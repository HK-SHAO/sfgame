import { LitElement, css, html, type PropertyValues } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import type { SourceKind } from '../sim/types'
import type { HudState, LevelDef, SourcePlacement } from '../game/types'
import { GameController } from './controller'

/** HUD 状态变化事件：detail 为最新 HUD 状态。 */
export const HUD_CHANGE = 'hudchange'
/** 放置被拒绝事件：detail 为被拒绝的源类型（预算耗尽或位置无效）。 */
export const DENY = 'deny'
/** 源集合变化事件：detail 为当前全部源的放置快照（URL 双向同步）。 */
export const SRC_CHANGE = 'sourceschange'

/** 游戏画布宿主：唯一持有 GameController。HUD 状态经事件在更新周期外派发，避免 change-in-update 告警。 */
@customElement('sf-game')
export class SfGame extends LitElement {
  @property({ attribute: false }) level: LevelDef | null = null
  /** 进入关卡时的初始源放置（来自 URL ?src=...），在控制器创建后应用 */
  @property({ attribute: false }) initialSources: SourcePlacement[] = []
  /** 游戏速率（倍速），控制器创建后与运行中均实时转发给循环 */
  @property({ attribute: false }) rate = 1

  private controller: GameController | null = null

  protected override firstUpdated() {
    if (!this.isConnected || !this.level) return
    const canvas = this.renderRoot.querySelector('canvas')
    if (!canvas) return
    // 宿主=本元素：供控制器做尺寸适配与 ResizeObserver 监听。
    // 注意 canvas 是 shadow root 的直接子节点，其 parentElement 恒为 null，
    // 不能像 light DOM 那样隐式推断，必须显式传入。
    this.controller = new GameController(canvas, this.level, {
      onHud: (s) => this.dispatchEvent(new CustomEvent<HudState>(HUD_CHANGE, { detail: s })),
      onDeny: (kind) => this.dispatchEvent(new CustomEvent<SourceKind>(DENY, { detail: kind })),
      onSources: (s) =>
        this.dispatchEvent(new CustomEvent<SourcePlacement[]>(SRC_CHANGE, { detail: s })),
    }, this)
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

  /** 重开本局：清场复位飞机，保留玩家已放置的源。 */
  restart() {
    this.controller?.restart()
  }

  applySources(list: SourcePlacement[]) {
    this.controller?.applySources(list)
  }

  protected override render() {
    return html`
      <canvas role="img" aria-label="造风：放置热源与冷源，用气流把纸飞机送达目标"></canvas>
    `
  }

  static styles = css`
    /* shadow DOM 不继承全局 box-sizing */
    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }

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
      /* WebGL 不可用/缓冲未初始化时的兜底底色：天空色而非黑屏 */
      background: #fff8ea;
    }
  `
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-game': SfGame
  }
}
