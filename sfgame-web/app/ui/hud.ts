import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import type { HudState } from '../game/types.ts'
import type { SourceKind } from '../sim/types.ts'
import { boxReset, buttonReset, glassChip, reduceMotion } from './shared-styles.ts'
import { iconFlame, iconHome, iconPause, iconPlay, iconReset, iconSnow, iconSoundOff, iconSoundOn } from './icons.ts'

// 游戏 HUD 头：从 app.ts 拆出（热冷余量 + 主页/暂停/速率/重置/声音按钮 + deny 抖动）
@customElement('sf-hud')
export class SfHud extends LitElement {
  @property({ attribute: false }) hud: HudState = {
    phase: 'playing',
    hotLeft: 0,
    coldLeft: 0,
    time: 0,
    extra: 0,
    sources: 0,
    paused: false,
  }
  @property({ type: Boolean }) muted = false
  @property({ type: Number }) rate = 1

  private speedLabel(): string {
    return this.rate < 1 ? '0.5×' : `${this.rate}×`
  }

  private onBack = () => this.dispatchEvent(new Event('back'))
  private onPause = () => this.dispatchEvent(new Event('pause'))
  private onSpeed = () => this.dispatchEvent(new Event('speed'))
  private onRestart = () => this.dispatchEvent(new Event('restart'))
  private onSound = () => this.dispatchEvent(new Event('sound'))

  // 放置被拒抖动：目标在 hud 内，动画就地执行
  deny(kind: SourceKind) {
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
    return html`
      <header class="hud">
        <div class="hud-left">
          <button class="icon-btn" @click=${this.onBack} aria-label="回到主页" title="回到主页">
            ${iconHome}<span class="lbl">主页</span>
          </button>
        </div>
        <div class="hud-right">
          <span
            class="chip hot ${this.hud.hotLeft === 0 ? 'empty' : ''}"
            role="status"
            aria-label="剩余热源 ${this.hud.hotLeft === Infinity ? '无限' : this.hud.hotLeft}"
          >
            ${iconFlame}<b>${this.hud.hotLeft === Infinity ? '∞' : this.hud.hotLeft}</b>
          </span>
          <span
            class="chip cold ${this.hud.coldLeft === 0 ? 'empty' : ''}"
            role="status"
            aria-label="剩余冷源 ${this.hud.coldLeft === Infinity ? '无限' : this.hud.coldLeft}"
          >
            ${iconSnow}<b>${this.hud.coldLeft === Infinity ? '∞' : this.hud.coldLeft}</b>
          </span>
          <button
            class="icon-btn pause"
            @click=${this.onPause}
            aria-label=${this.hud.paused ? '恢复' : '暂停'}
            aria-pressed=${this.hud.paused}
            title=${this.hud.paused ? '恢复' : '暂停'}
          >
            ${this.hud.paused ? iconPlay : iconPause}<span class="lbl">${this.hud.paused ? '恢复' : '暂停'}</span>
          </button>
          <button class="icon-btn speed" @click=${this.onSpeed} aria-label="游戏速率 ${this.speedLabel()}">
            <span class="lbl">速率</span><b>${this.speedLabel()}</b>
          </button>
          <button class="icon-btn" @click=${this.onRestart} aria-label="重置关卡">
            ${iconReset}<span class="lbl">重置</span>
          </button>
          <button
            class="icon-btn"
            @click=${this.onSound}
            aria-label=${this.muted ? '开启声音' : '关闭声音'}
            aria-pressed=${!this.muted}
          >
            ${this.muted ? iconSoundOff : iconSoundOn}<span class="lbl">声音</span>
          </button>
        </div>
      </header>
    `
  }

  static styles = [
    boxReset,
    buttonReset,
    glassChip,
    reduceMotion,
    css`
      :host {
        display: block;
        /* --hud-pad/--hud-h 定义在 :root（尺寸 token 单源）；.hud 是 absolute 不撑高，显式 height 才与可视高度一致 */
        height: var(--hud-h);
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

      .hud {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--sp-2);
        padding: calc(var(--hud-pad) + env(safe-area-inset-top, 0px))
          calc(var(--hud-pad) + env(safe-area-inset-right, 0px)) var(--hud-pad)
          calc(var(--hud-pad) + env(safe-area-inset-left, 0px));
        pointer-events: none;
      }

      .hud > * {
        pointer-events: auto;
        flex: none;
      }

      .hud-left,
      .hud-right {
        display: flex;
        align-items: center;
        gap: var(--sp-2);
      }

      .lbl {
        display: none;
        white-space: nowrap;
      }

      /* 42rem ≈ 带标签内容宽 */
      @container (min-width: 42rem) {
        .lbl {
          display: inline;
        }
      }

      .icon-btn {
        min-width: var(--ctl-h);
        height: var(--ctl-h);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--sp-1-5);
        padding: 0 var(--sp-3);
        border-radius: var(--r-md);
        corner-shape: squircle;
        color: var(--ink);
        transition: transform 100ms ease-out, background 120ms ease-out;
      }

      .icon-btn svg {
        width: var(--icon-lg);
        height: var(--icon-lg);
      }

      .icon-btn.speed b {
        font-variant-numeric: tabular-nums;
      }

      .chip {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-1);
        height: var(--ctl-h);
        padding: 0 var(--sp-3);
        border-radius: var(--r-md);
        corner-shape: squircle;
        font-size: 0.875rem;
      }

      .chip svg {
        width: var(--icon-sm);
        height: var(--icon-sm);
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

      /* 26rem ≈ 无标签内容宽下限：再窄收紧控件，保证永不溢出（替代旧横向滚动）。
         置于常规定义之后：同特异性容器查询必须后定义才覆盖 */
      @container (max-width: 26rem) {
        .hud,
        .hud-left,
        .hud-right {
          gap: var(--sp-1);
        }

        .icon-btn {
          min-width: 2.25rem;
          padding: 0 var(--sp-2);
        }

        .icon-btn svg {
          width: var(--icon-md);
          height: var(--icon-md);
        }

        .chip {
          padding: 0 var(--sp-2);
        }
      }
    `,
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-hud': SfHud
  }
}
