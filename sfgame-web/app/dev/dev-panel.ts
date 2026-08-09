import { LitElement, css, html } from 'lit'
import { customElement, query } from 'lit/decorators.js'
import { iconGear } from '../ui/icons'

// 开发面板：:host 是容器，外边距一次性让开四周间距/安全区（gap + env 单处承担）；
// 内层 .panel 的坐标即容器内 0..clientWidth/Height 纯坐标，拖拽/吸附/钳制零换算
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
  private pointerId = -1
  private ready = false
  private resizeObs: ResizeObserver | null = null

  @query('.panel') private panelEl!: HTMLDivElement

  static styles = css`
    :host {
      position: fixed;
      inset: 0;
      /* 间距/安全区全由外边距让开（见组件级注释）：内部坐标从 0 起 */
      margin: calc(var(--dev-gap) + env(safe-area-inset-top, 0px))
        calc(var(--dev-gap) + env(safe-area-inset-right, 0px))
        calc(var(--dev-gap) + env(safe-area-inset-bottom, 0px))
        calc(var(--dev-gap) + env(safe-area-inset-left, 0px));
      z-index: 9999;
      pointer-events: none;
      /* --dev-* 穿透 shadow 边界，供装配组件复用 */
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
      touch-action: none;
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

    /* 插槽内容随 flex-shrink 被压扁（slot 默认 display:contents，内容直接成为 flex 项）：
       定 flex:none 保住自然高度，超高时走 max-height 内部滚动 */
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
    window.addEventListener('resize', this.onWinResize)
  }

  override disconnectedCallback() {
    // 拖拽中卸载的兜底：清掉 window 级手势监听，防泄漏
    this.endDrag()
    this.resizeObs?.disconnect()
    this.resizeObs = null
    window.removeEventListener('resize', this.onWinResize)
    super.disconnectedCallback()
  }

  protected override firstUpdated() {
    // 默认左下角：位置自此由 JS 持有（transform 表达容器内坐标），面板尺寸变化由 RO 兜底钳制
    void this.updateComplete.then(() => {
      const r = this.panelEl.getBoundingClientRect()
      this.w = r.width
      this.h = r.height
      this.x = 0
      this.y = this.clientHeight - r.height
      this.applyTransform()
      this.ready = true
      this.resizeObs = new ResizeObserver(this.onSelfResize)
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
    // e.target 在 shadow DOM 外被重定向成宿主，须用 composedPath()[0] 取真实目标
    const target = e.composedPath()[0] as Element | null
    if (!target || !target.closest('.head')) return
    const r = this.panelEl.getBoundingClientRect()
    this.dragging = true
    this.pointerId = e.pointerId
    this.w = r.width
    this.h = r.height
    this.prevX = e.clientX
    this.prevY = e.clientY
    this.panelEl.style.transition = 'none'
    try {
      this.panelEl.setPointerCapture(e.pointerId)
    } catch {
      /* capture 失败时 window 级监听兜底，up 依旧必达 */
    }
    // 手势收尾挂 window：指针在元素外/窗口内任何位置抬起都能拿到 up，绝不残留 dragging
    window.addEventListener('pointermove', this.onMove)
    window.addEventListener('pointerup', this.onUp)
    window.addEventListener('pointercancel', this.onUp)
  }

  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return
    this.x = this.clampX(this.x + (e.clientX - this.prevX))
    this.y = this.clampY(this.y + (e.clientY - this.prevY))
    this.prevX = e.clientX
    this.prevY = e.clientY
    this.applyTransform()
  }

  // 拖拽结束统一清理：无论正常抬起/cancel/卸载，都走这里收尾
  private endDrag() {
    if (!this.dragging) return
    this.dragging = false
    if (this.panelEl.hasPointerCapture(this.pointerId)) this.panelEl.releasePointerCapture(this.pointerId)
    window.removeEventListener('pointermove', this.onMove)
    window.removeEventListener('pointerup', this.onUp)
    window.removeEventListener('pointercancel', this.onUp)
  }

  private onUp = () => {
    this.endDrag()
    this.snapToEdge()
  }

  private onWinResize = () => {
    if (this.dragging || !this.ready) return
    // 外边距/根字号变化只改边界，按新边界重贴即可
    this.snapToEdge()
  }

  // 尺寸变化（内容增减）后钳回容器内（无动画）；吸附动画只在松手/旋转时触发
  private onSelfResize = () => {
    if (this.dragging || !this.ready) return
    const r = this.panelEl.getBoundingClientRect()
    this.w = r.width
    this.h = r.height
    const tx = this.clampX(this.x)
    const ty = this.clampY(this.y)
    if (tx === this.x && ty === this.y) return
    this.x = tx
    this.y = ty
    this.panelEl.style.transition = 'none'
    this.applyTransform()
  }

  private clampX(v: number) {
    return Math.min(Math.max(v, 0), this.clientWidth - this.w)
  }

  private clampY(v: number) {
    return Math.min(Math.max(v, 0), this.clientHeight - this.h)
  }

  // 两轴独立贴边：容器四角即 gap 距视口边缘，吸附动画走 transform 过渡
  private snapToEdge() {
    // 尺寸取实时 rect：旋转后根字号变化会改面板宽高，拖拽快照的 w/h 已失效
    const r = this.panelEl.getBoundingClientRect()
    this.w = r.width
    this.h = r.height
    const rx = this.clientWidth - r.width
    const ry = this.clientHeight - r.height
    const tx = this.x <= rx - this.x ? 0 : rx
    const ty = this.y <= ry - this.y ? 0 : ry
    if (tx === this.x && ty === this.y) return
    this.x = tx
    this.y = ty
    this.panelEl.style.transition = 'transform 360ms cubic-bezier(0.22, 1, 0.36, 1)'
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
