import { LitElement, css, html } from 'lit'
import { customElement } from 'lit/decorators.js'
import { iconGear } from './icons'

/**
 * dev 开发面板（?dev=1）：可拖拽（头部手柄、吸附到四周）的面板外壳。
 * 性能块、关卡编辑器等 dev 控件经 <slot> 装配在面板内，由 DevTools 组装——
 * 面板只负责定位/主题/滚动，对各控件一无所知。
 * 默认宽约视图一半（min(50vw, 30rem)），最大不超视图（保留四周间距），
 * 内容超高时面板内滚动。主题色经 --dev-* CSS 变量供装配组件复用
 * （继承穿透 shadow 边界）。
 */
@customElement('sf-dev-panel')
export class SfDevPanel extends LitElement {
  /** 拖拽状态：面板当前左上角（视口坐标）与按下时基准 */
  private dragging = false
  private x = 0
  private y = 0
  private w = 0
  private h = 0
  /** 上一次指针位置（增量跟手，无累计误差；不依赖 movementX 兼容性） */
  private prevX = 0
  private prevY = 0
  /** 吸附间距（px）：与 .hud 的 padding 同系统（横向 0.625rem、纵向 0.5rem），
   * 根字号变化时重读 */
  private gapX = 10
  private gapY = 8
  /** CSS 定位基准（firstUpdated 固定，transform 偏移相对它计算） */
  private originX = 0
  private originY = 0

  static styles = css`
    :host {
      /* 面板主题（CSS 变量穿透 shadow 边界，装配进来的组件复用） */
      --dev-fg: #ffe9c9;
      --dev-hairline: rgba(255, 233, 201, 0.18);
      --dev-hover: rgba(255, 233, 201, 0.08);
      --dev-input: rgba(0, 0, 0, 0.35);
      --dev-accent-fg: #1d160e;
      --dev-accent-bg: #ffe9c9;
      --dev-error: #ffb4a0;

      position: fixed;
      /* 初始左上角：与 .hud 同间距系统——横向 0.625rem 贴边；
         纵向 hud 总高 3.5rem（padding 0.5 + 按钮 2.5 + padding 0.5）+ 0.5rem 间距 */
      top: calc(4rem + env(safe-area-inset-top, 0px));
      left: calc(0.625rem + env(safe-area-inset-left, 0px));
      right: auto;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 0.3125rem;
      /* 默认宽约视图一半；最大不超视图（四周保距） */
      width: min(50vw, 30rem);
      min-width: min(50vw, 30rem);
      max-width: min(44rem, calc(100vw - 1.25rem));
      /* 不超视图高度：内容超高时面板内滚动 */
      max-height: calc(100dvh - 4.5rem - env(safe-area-inset-top, 0px));
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 233, 201, 0.25) transparent;
      /* 内左右间距收紧：各装配块自带 0.375rem 侧距，整体仍对齐 */
      padding: 0.25rem 0.375rem;
      border-radius: 0.625rem;
      corner-shape: squircle;
      background: rgba(20, 18, 14, 0.72);
      color: var(--dev-fg);
      touch-action: none;
      user-select: none;
      will-change: transform;
    }

    /* 拖拽手柄：头部一行（图标 + 标签，间距与装配区控件一致），
       slot 里的控件（按钮/编辑框）不参与 */
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

    /* 头部与装配区之间的分割线 */
    .divider {
      height: 1px;
      margin: 0.0625rem 0;
      background: var(--dev-hairline);
    }
  `

  constructor() {
    super()
    // 指针监听绑在元素自身，重连不丢，只需绑定一次
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
    // 左上角初始定位固化到 left/top，transform 从 0 偏移开始
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
      <!-- dev 控件（性能块/关卡编辑器）装配点：随面板拖动/吸附 -->
      <slot></slot>
    `
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    // 只允许从头部手柄拖动；注意 e.target 在 shadow DOM 外会被重定向成宿主，
    // 必须用 composedPath()[0] 取真实目标（否则排除失效/拖不动）
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
    // 松手立即吸附到最近边缘（缓动动画即运动感）
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

  /** 松手/视口变化后吸附到最近的一条边（另一维保持），带缓动动画 */
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

  /** 位置经 transform 表达（相对 CSS 定位的偏移，合成器线程移动） */
  private applyTransform(x: number, y: number) {
    this.style.transform = `translate(${x - this.originX}px, ${y - this.originY}px)`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-dev-panel': SfDevPanel
  }
}
