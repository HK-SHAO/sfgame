import { LitElement, css, html } from 'lit'
import { customElement, query } from 'lit/decorators.js'
import { iconGear } from '../ui/icons.ts'

const INERTIA_DAMP = 6
const INERTIA_ANIM = 'transform 360ms cubic-bezier(0.22, 1, 0.36, 1)'

@customElement('sf-dev-panel')
export class SfDevPanel extends LitElement {
  private dragging = false
  private x = 0
  private y = 0
  private w = 0
  private h = 0
  private prevX = 0
  private prevY = 0
  private prevT = 0
  private vx = 0
  private vy = 0
  private pointerId = -1
  private ready = false
  private resizeObs: ResizeObserver | null = null

  @query('.panel') private panelEl!: HTMLDivElement

  static styles = css`
    :host {
      position: fixed;
      inset: 0;
      margin: calc(var(--hud-h))
        calc(var(--dev-gap) + env(safe-area-inset-right, 0px))
        calc(var(--dev-gap) + env(safe-area-inset-bottom, 0px))
        calc(var(--dev-gap) + env(safe-area-inset-left, 0px));
      transition: margin 180ms ease-out;
      z-index: 9999;
      pointer-events: none;
      --dev-gap: 0.5625rem;
      --dev-fg: #ffe9c9;
      --dev-hairline: rgba(255, 233, 201, 0.18);
      --dev-hover: rgba(255, 233, 201, 0.08);
      --dev-input: rgba(0, 0, 0, 0.35);
      --dev-accent-fg: #1d160e;
      --dev-accent-bg: #ffe9c9;
      --dev-error: #ffc9b6;
    }

    .panel {
      position: absolute;
      left: 0;
      top: 0;
      box-sizing: border-box;
      width: min(20rem, 100%);
      max-height: 100%;
      display: flex;
      flex-direction: column;
      gap: var(--sp-1);
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 233, 201, 0.25) transparent;
      padding: var(--sp-1) var(--sp-2);
      border-radius: var(--r-md);
      corner-shape: squircle;
      background: rgba(20, 18, 14, 0.72);
      color: var(--dev-fg);
      pointer-events: auto;
      user-select: none;
      will-change: transform;
    }

    .head {
      flex: none;
      display: flex;
      align-items: center;
      gap: var(--sp-2);
      padding: var(--sp-1);
      font-size: 0.6875rem;
      line-height: 1.5;
      cursor: grab;
      touch-action: none;
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
      flex: none;
      height: 1px;
      margin: 0.0625rem 0;
      background: var(--dev-hairline);
    }

    ::slotted(*) {
      flex: none;
    }
  `

  constructor() {
    super()
    this.addEventListener('pointerdown', this.onDown)
  }

  override connectedCallback() {
    super.connectedCallback()
    window.addEventListener('resize', this.onBoundsChange)
  }

  override disconnectedCallback() {
    this.endDrag()
    this.resizeObs?.disconnect()
    this.resizeObs = null
    window.removeEventListener('resize', this.onBoundsChange)
    super.disconnectedCallback()
  }

  protected override firstUpdated() {
    void this.updateComplete.then(() => {
      if (!this.isConnected) return
      const r = this.panelEl.getBoundingClientRect()
      this.w = r.width
      this.h = r.height
      this.x = 0
      this.y = 0
      this.applyTransform()
      this.ready = true
      this.resizeObs = new ResizeObserver(this.onBoundsChange)
      this.resizeObs.observe(this.panelEl)
    })
  }

  protected override render() {
    return html`
      <div class="panel">
        <div class="head">
          ${iconGear}
          <span>开发面板</span>
        </div>
        <div class="divider"></div>
        <slot></slot>
      </div>
    `
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 || this.dragging) return
    const target = e.composedPath()[0] as Element | null
    if (!target || !target.closest('.head')) return
    this.panelEl.style.transition = 'none'
    const r = this.panelEl.getBoundingClientRect()
    this.dragging = true
    this.pointerId = e.pointerId
    this.w = r.width
    this.h = r.height
    this.prevX = e.clientX
    this.prevY = e.clientY
    this.prevT = e.timeStamp
    try {
      this.panelEl.setPointerCapture(e.pointerId)
    } catch {
    }
    window.addEventListener('pointermove', this.onMove)
    window.addEventListener('pointerup', this.onUp)
    window.addEventListener('pointercancel', this.endDrag)
  }

  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return
    const dx = e.clientX - this.prevX
    const dy = e.clientY - this.prevY
    const dt = Math.max((e.timeStamp - this.prevT) / 1000, 1e-3)
    this.vx = dx / dt
    this.vy = dy / dt
    this.prevX = e.clientX
    this.prevY = e.clientY
    this.prevT = e.timeStamp
    this.x = Math.min(Math.max(this.x + dx, 0), this.clientWidth - this.w)
    this.y = Math.min(Math.max(this.y + dy, 0), this.clientHeight - this.h)
    this.applyTransform()
  }

  private endDrag = () => {
    if (!this.dragging) return
    this.dragging = false
    if (this.panelEl.hasPointerCapture(this.pointerId)) this.panelEl.releasePointerCapture(this.pointerId)
    window.removeEventListener('pointermove', this.onMove)
    window.removeEventListener('pointerup', this.onUp)
    window.removeEventListener('pointercancel', this.endDrag)
  }

  private onUp = () => {
    this.endDrag()
    const rx = this.clientWidth - this.w
    const ry = this.clientHeight - this.h
    const x = Math.min(Math.max(this.x + this.vx / INERTIA_DAMP, 0), rx)
    const y = Math.min(Math.max(this.y + this.vy / INERTIA_DAMP, 0), ry)
    if (x === this.x && y === this.y) return
    this.x = x
    this.y = y
    this.panelEl.style.transition = INERTIA_ANIM
    this.applyTransform()
  }

  private onBoundsChange = () => {
    if (this.dragging || !this.ready) return
    const r = this.panelEl.getBoundingClientRect()
    this.w = r.width
    this.h = r.height
    const x = Math.min(Math.max(this.x, 0), this.clientWidth - this.w)
    const y = Math.min(Math.max(this.y, 0), this.clientHeight - this.h)
    if (x === this.x && y === this.y) return
    this.x = x
    this.y = y
    this.panelEl.style.transition = 'none'
    this.applyTransform()
  }

  private applyTransform() {
    this.panelEl.style.transform = `translate(${this.x}px, ${this.y}px)`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-dev-panel': SfDevPanel
  }
}
