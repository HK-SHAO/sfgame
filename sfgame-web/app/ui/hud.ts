import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type { HudState } from '../game/types.ts'
import type { SourceKind } from '../sim/types.ts'
import { boxReset, buttonReset, glassChip, reduceMotion } from './shared-styles.ts'
import { iconFlame, iconHome, iconPause, iconPlay, iconReset, iconSnow, iconSoundOff, iconSoundOn } from './icons.ts'

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
  @state() private helpOpen = false

  private speedLabel(): string {
    return this.rate < 1 ? '0.5×' : `${this.rate}×`
  }

  private onBack = () => this.dispatchEvent(new Event('back'))
  private onPause = () => this.dispatchEvent(new Event('pause'))
  private onSpeed = () => this.dispatchEvent(new Event('speed'))
  private onRestart = () => this.dispatchEvent(new Event('restart'))
  private onSound = () => this.dispatchEvent(new Event('sound'))
  private openHelp = () => {
    this.helpOpen = true
  }
  private closeHelp = () => {
    this.helpOpen = false
  }

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
          <button
            class="chip hot ${this.hud.hotLeft === 0 ? 'empty' : ''}"
            @click=${this.openHelp}
            aria-haspopup="dialog"
            title="热源是什么？"
            aria-label="剩余热源 ${this.hud.hotLeft === Infinity ? '无限' : this.hud.hotLeft}，查看说明"
          >
            ${iconFlame}<b>${this.hud.hotLeft === Infinity ? '∞' : this.hud.hotLeft}</b>
          </button>
          <button
            class="chip cold ${this.hud.coldLeft === 0 ? 'empty' : ''}"
            @click=${this.openHelp}
            aria-haspopup="dialog"
            title="冷源是什么？"
            aria-label="剩余冷源 ${this.hud.coldLeft === Infinity ? '无限' : this.hud.coldLeft}，查看说明"
          >
            ${iconSnow}<b>${this.hud.coldLeft === Infinity ? '∞' : this.hud.coldLeft}</b>
          </button>
          <button class="icon-btn speed" @click=${this.onSpeed} aria-label="游戏速率 ${this.speedLabel()}">
            <span class="lbl">速率</span><b>${this.speedLabel()}</b>
          </button>
          <button
            class="icon-btn pause"
            @click=${this.onPause}
            aria-label=${this.hud.paused ? '恢复' : '暂停'}
            aria-pressed=${this.hud.paused}
            title=${this.hud.paused ? '恢复' : '暂停'}
          >
            ${this.hud.paused ? iconPlay : iconPause}<span class="lbl">${this.hud.paused ? '恢复' : '暂停'}</span>
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
      ${this.helpOpen
        ? html`
            <div class="help-scrim" @click=${this.closeHelp}>
              <div
                class="help-card"
                role="dialog"
                aria-modal="true"
                aria-label="冷源与热源"
                @click=${(e: Event) => e.stopPropagation()}
              >
                <div class="help-row hot">
                  ${iconFlame}
                  <p><b>热源</b>加热空气，热空气上升，造出上升气流</p>
                </div>
                <div class="help-row cold">
                  ${iconSnow}
                  <p><b>冷源</b>冷却空气，冷空气下沉，压出下沉气流</p>
                </div>
                <p class="help-foot">温差即风——用冷热摆布气流，托起纸飞机。</p>
                <button class="help-ok" @click=${this.closeHelp}>知道了</button>
              </div>
            </div>
          `
        : nothing}
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
        transition: transform 100ms ease-out, background 120ms ease-out, box-shadow 120ms ease-out;
      }

      .icon-btn:hover,
      .chip:hover {
        background: rgba(255, 255, 255, 0.85);
        box-shadow: var(--shadow-card);
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
        color: var(--ink);
        transition: background 120ms ease-out, box-shadow 120ms ease-out;
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

      .help-scrim {
        position: fixed;
        inset: 0;
        z-index: 30;
        display: flex;
        padding: var(--page-pad-y) calc(var(--page-pad-x) + env(safe-area-inset-right, 0px))
          calc(var(--page-pad-y) + env(safe-area-inset-bottom, 0px))
          calc(var(--page-pad-x) + env(safe-area-inset-left, 0px));
        background: var(--scrim);
        animation: help-fade 200ms ease-out;
      }

      .help-card {
        width: 100%;
        max-width: var(--maxw-dialog);
        margin: auto;
        padding: var(--sp-5) var(--sp-5) var(--sp-4);
        background: var(--card);
        backdrop-filter: var(--blur-glass);
        -webkit-backdrop-filter: var(--blur-glass);
        border: 1px solid rgba(255, 255, 255, 0.7);
        border-radius: var(--r-xl);
        corner-shape: squircle;
        box-shadow: var(--shadow-overlay);
        animation: help-pop 280ms cubic-bezier(0.3, 1.35, 0.5, 1);
      }

      .help-row {
        display: flex;
        align-items: flex-start;
        gap: var(--sp-3);
      }

      .help-row + .help-row {
        margin-top: var(--sp-3);
      }

      .help-row svg {
        flex: none;
        width: var(--icon-lg);
        height: var(--icon-lg);
        margin-top: 0.125rem;
      }

      .help-row.hot svg {
        color: var(--hot);
      }

      .help-row.cold svg {
        color: var(--cold);
      }

      .help-row p {
        margin: 0;
        font-size: 0.875rem;
        line-height: 1.6;
      }

      .help-foot {
        margin: var(--sp-4) 0 0;
        font-size: 0.75rem;
        line-height: 1.6;
        color: var(--ink-soft);
        text-align: center;
      }

      .help-ok {
        width: 100%;
        margin-top: var(--sp-3);
        padding: var(--sp-2-5) var(--sp-4);
        font-size: 0.875rem;
        font-weight: 600;
        border-radius: var(--r-md);
        corner-shape: squircle;
        background: var(--ink-wash);
        transition: transform 100ms ease-out, background 120ms ease-out;
      }

      .help-ok:hover {
        background: rgba(61, 52, 39, 0.12);
      }

      @keyframes help-fade {
        from {
          opacity: 0;
        }
      }

      @keyframes help-pop {
        from {
          opacity: 0;
          transform: scale(0.9);
        }
      }

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
