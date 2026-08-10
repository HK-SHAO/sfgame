import { LitElement, css, html } from 'lit'
import { customElement, query } from 'lit/decorators.js'
import { iconGear } from '../ui/icons.ts'

// 松手惯性：指数阻尼总位移 = 速度/阻尼，一次 transition 缓动到预测终点（含撞边钳制）。
// 不做逐帧模拟：无 rAF、无状态机，只剩一次样式过渡
const INERTIA_DAMP = 6
const INERTIA_ANIM = 'transform 360ms cubic-bezier(0.22, 1, 0.36, 1)'

// 开发面板：:host 挂在 hud 的 shadow 内（top 锚 hud 底，天然不与 header 重合）；
// 外边距让开三边间距/安全区；内层 .panel 坐标即容器内 0..clientWidth/Height 纯坐标
@customElement('sf-dev-panel')
export class SfDevPanel extends LitElement {
  private dragging = false
  private x = 0
  private y = 0
  private w = 0
  private h = 0
  // 增量跟手（不依赖 movementX 兼容性）+ 末段速度供松手惯性
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
    window.addEventListener('resize', this.onBoundsChange)
  }

  override disconnectedCallback() {
    // 拖拽中卸载的兜底：清掉窗口级监听，防泄漏
    this.endDrag()
    this.resizeObs?.disconnect()
    this.resizeObs = null
    window.removeEventListener('resize', this.onBoundsChange)
    super.disconnectedCallback()
  }

  protected override firstUpdated() {
    // 默认左上角：位置自此由 JS 持有（transform 表达容器内坐标），面板尺寸变化由 RO 兜底钳制
    void this.updateComplete.then(() => {
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
    // e.target 在 shadow DOM 外被重定向成宿主，须用 composedPath()[0] 取真实目标
    const target = e.composedPath()[0] as Element | null
    if (!target || !target.closest('.head')) return
    // 拖拽跟手前取消可能残留的惯性过渡
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
      /* capture 失败时 window 级监听兜底，up 依旧必达 */
    }
    // 手势收尾挂 window：指针在元素外/窗口内任何位置抬起都能拿到 up，绝不残留 dragging
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

  // 拖拽结束统一清理：无论正常抬起/cancel/卸载，都走这里收尾
  private endDrag = () => {
    if (!this.dragging) return
    this.dragging = false
    if (this.panelEl.hasPointerCapture(this.pointerId)) this.panelEl.releasePointerCapture(this.pointerId)
    window.removeEventListener('pointermove', this.onMove)
    window.removeEventListener('pointerup', this.onUp)
    window.removeEventListener('pointercancel', this.endDrag)
  }

  // 松手惯性：按末段速度预测滑行终点（指数阻尼总位移 v/k，撞边即钳在边界），
  // 一次 easeOut 过渡滑过去；过渡期间 transform 由浏览器插值，结束时即停
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

  // 视口/自身尺寸变化后钳回容器内（无动画：transition 显式归零，不干扰拖拽/惯性）
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
