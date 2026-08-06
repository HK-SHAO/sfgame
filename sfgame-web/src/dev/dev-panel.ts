import { LitElement, css, html } from 'lit'
import { customElement } from 'lit/decorators.js'
import { iconGear } from '../ui/icons'

@customElement('sf-dev-panel')
export class SfDevPanel extends LitElement {
  private dragging = false
  private x = 0
  private y = 0
  private w = 0
  private h = 0
  // 增量跟手（不依赖 movementX 兼容性）
  private prevX = 0
  private prevY = 0
  private gapX = 10
  private gapY = 8
  private originX = 0
  private originY = 0

  static styles = css`
    :host {
      /* --dev-* 穿透 shadow 边界，供装配组件复用 */
      --dev-fg: #ffe9c9;
      --dev-hairline: rgba(255, 233, 201, 0.18);
      --dev-hover: rgba(255, 233, 201, 0.08);
      --dev-input: rgba(0, 0, 0, 0.35);
      --dev-accent-fg: #1d160e;
      --dev-accent-bg: #ffe9c9;
      --dev-error: #ffb4a0;

      position: fixed;
      /* 4rem = hud 总高 3.5rem + 0.5rem 间距 */
      top: calc(4rem + env(safe-area-inset-top, 0px));
      left: calc(0.625rem + env(safe-area-inset-left, 0px));
      right: auto;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 0.3125rem;
      width: min(50vw, 30rem);
      min-width: min(50vw, 30rem);
      max-width: min(44rem, calc(100vw - 1.25rem));
      max-height: calc(100dvh - 4.5rem - env(safe-area-inset-top, 0px));
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 233, 201, 0.25) transparent;
      padding: 0.25rem 0.375rem;
      border-radius: 0.625rem;
      corner-shape: squircle;
      background: rgba(20, 18, 14, 0.72);
      color: var(--dev-fg);
      touch-action: none;
      user-select: none;
      will-change: transform;
    }

    .head {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.125rem 0.375rem;
      font-size: 0.6875rem;
      line-height: 1.5;
      cursor: grab;
      -webkit-user-select: none;
      user-select: none;
    }

    .head svg {
      flex: none;
      width: 0.75rem;
      height: 0.75rem;
      opacity: 0.75;
    }

    .head:active {
      cursor: grabbing;
    }

    .divider {
      height: 1px;
      margin: 0.0625rem 0;
      background: var(--dev-hairline);
    }
  `

  constructor() {
    super()
    this.addEventListener('pointerdown', this.onDown)
    this.addEventListener('pointermove', this.onMove)
    this.addEventListener('pointerup', this.onUp)
    this.addEventListener('pointercancel', this.onUp)
  }

  override connectedCallback() {
    super.connectedCallback()
    window.addEventListener('resize', this.onWinResize)
  }

  override disconnectedCallback() {
    window.removeEventListener('resize', this.onWinResize)
    super.disconnectedCallback()
  }

  protected override firstUpdated() {
    void this.updateComplete.then(() => {
      this.updateGap()
      const r = this.getBoundingClientRect()
      this.originX = r.left
      this.originY = r.top
      this.style.left = `${r.left}px`
      this.style.top = `${r.top}px`
      this.style.right = 'auto'
    })
  }

  protected override render() {
    return html`
      <div class="head">
        ${iconGear}
        <span>开发面板</span>
      </div>
      <div class="divider"></div>
      <slot></slot>
    `
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    // e.target 在 shadow DOM 外被重定向成宿主，须用 composedPath()[0] 取真实目标
    const target = e.composedPath()[0] as Element | null
    if (!target || !target.closest('.head')) return
    const r = this.getBoundingClientRect()
    this.dragging = true
    this.x = r.left
    this.y = r.top
    this.w = r.width
    this.h = r.height
    this.prevX = e.clientX
    this.prevY = e.clientY
    this.style.transition = 'none'
    try {
      this.setPointerCapture(e.pointerId)
    } catch {
      /* 个别环境不支持时退化为普通移动 */
    }
  }

  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return
    this.x = Math.min(Math.max(this.x + (e.clientX - this.prevX), this.gapX), innerWidth - this.w - this.gapX)
    this.y = Math.min(Math.max(this.y + (e.clientY - this.prevY), this.gapY), innerHeight - this.h - this.gapY)
    this.prevX = e.clientX
    this.prevY = e.clientY
    this.applyTransform(this.x, this.y)
  }

  private onUp = () => {
    if (!this.dragging) return
    this.dragging = false
    this.snapToEdge()
  }

  private onWinResize = () => {
    if (this.dragging) return
    this.updateGap()
    this.snapToEdge()
  }

  private updateGap() {
    const fz = parseFloat(getComputedStyle(document.documentElement).fontSize)
    this.gapX = 0.625 * fz
    this.gapY = 0.5 * fz
  }

  private snapToEdge() {
    const r = this.getBoundingClientRect()
    const gx = this.gapX
    const gy = this.gapY
    const vw = innerWidth
    const vh = innerHeight
    const dRight = vw - r.right - gx
    const dBottom = vh - r.bottom - gy
    const min = Math.min(r.left - gx, dRight, r.top - gy, dBottom)
    let tx = r.left
    let ty = r.top
    if (min === r.left - gx) tx = gx
    else if (min === dRight) tx = vw - r.width - gx
    else if (min === r.top - gy) ty = gy
    else ty = vh - r.height - gy
    if (tx === r.left && ty === r.top) return
    this.style.transition = 'transform 360ms cubic-bezier(0.22, 1, 0.36, 1)'
    this.applyTransform(tx, ty)
  }

  private applyTransform(x: number, y: number) {
    this.style.transform = `translate(${x - this.originX}px, ${y - this.originY}px)`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-dev-panel': SfDevPanel
  }
}
