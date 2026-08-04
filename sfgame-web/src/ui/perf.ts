import { LitElement, css, html } from 'lit'
import { customElement } from 'lit/decorators.js'

/**
 * dev 模式（?dev=1）调试叠加层：仅做两件事——显示性能、可拖动吸附到四周。
 * 轻量原则：每帧只做加法与 push；文本每 WINDOW 帧才更新一次；
 * 拖拽位置经 transform 表达（合成器线程），不触发布局。
 */
export interface PerfSample {
  /** 本帧模拟 tick 总耗时（ms） */
  tickMs: number
  /** 本帧批构建（渲染 CPU 侧）耗时（ms） */
  batchMs: number
  /** 动态层顶点数 */
  vertices: number
  /** 上传字节数 */
  uploadBytes: number
  /** 游戏循环 rAF 帧数 / 实际渲染数 */
  loopFrames: number
  loopRenders: number
}

/** 统计窗口（帧数）：约 1.5 秒一个窗口 */
const WINDOW = 90

@customElement('sf-perf')
export class SfPerf extends LitElement {
  private intervals: number[] = []
  private frames = 0
  private lastAt = 0
  private tickSum = 0
  private batchSum = 0
  private last: PerfSample | null = null
  private text = 'perf 采集中…'

  /** 拖拽状态：面板当前左上角（视口坐标）与按下时基准 */
  private dragging = false
  private x = 0
  private y = 0
  private w = 0
  private h = 0
  /** 上一次指针位置（增量跟手，无累计误差；不依赖 movementX 兼容性） */
  private prevX = 0
  private prevY = 0
  /** 吸附间距（px）：0.875rem 换算（与 .hud 间距系统一致），根字号变化时重读 */
  private gap = 14
  /** CSS 定位基准（firstUpdated 固定，transform 偏移相对它计算） */
  private originX = 0
  private originY = 0

  static styles = css`
    :host {
      position: fixed;
      /* 初始左上角：避开 hud header（约 3.75rem 高），间距与 .hud 一致 */
      top: calc(4.25rem + env(safe-area-inset-top, 0px));
      left: calc(0.875rem + env(safe-area-inset-left, 0px));
      right: auto;
      z-index: 9999;
      padding: 6px 12px;
      /* 弧度与 .hud 元素一致（0.75rem squircle） */
      border-radius: 0.75rem;
      corner-shape: squircle;
      background: rgba(20, 18, 14, 0.72);
      color: #ffe9c9;
      font: 10.5px/1.6 ui-monospace, 'SF Mono', Menlo, monospace;
      white-space: pre;
      cursor: grab;
      touch-action: none;
      user-select: none;
      will-change: transform;
    }
  `

  constructor() {
    super()
    // 首次绑定放 constructor：箭头函数字段（onDown 等）在此刻已初始化，
    // 时机确定。随后由 connected/disconnected 对称接管（重连自动恢复）。
    this.bindEvents()
  }

  override connectedCallback() {
    super.connectedCallback()
    this.bindEvents()
    window.addEventListener('resize', this.onWinResize)
  }

  override disconnectedCallback() {
    this.unbindEvents()
    window.removeEventListener('resize', this.onWinResize)
    super.disconnectedCallback()
  }

  /** 绑定指针事件（addEventListener 同引用重复注册是幂等的，无需去重） */
  private bindEvents() {
    this.addEventListener('pointerdown', this.onDown)
    this.addEventListener('pointermove', this.onMove)
    this.addEventListener('pointerup', this.onUp)
    this.addEventListener('pointercancel', this.onUp)
  }

  /** 解除指针事件绑定（对称释放，防止监听泄漏） */
  private unbindEvents() {
    this.removeEventListener('pointerdown', this.onDown)
    this.removeEventListener('pointermove', this.onMove)
    this.removeEventListener('pointerup', this.onUp)
    this.removeEventListener('pointercancel', this.onUp)
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

  /** 每帧调用：只做加法，满窗口后刷新显示 */
  record(sample: PerfSample) {
    this.last = sample
    const now = performance.now()
    if (this.lastAt > 0) this.intervals.push(now - this.lastAt)
    this.lastAt = now
    this.tickSum += sample.tickMs
    this.batchSum += sample.batchMs
    if (++this.frames >= WINDOW) this.refresh()
  }

  protected override render() {
    return html`<span>${this.text}</span>`
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return
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
    // 增量跟手（每步位移叠加到当前坐标，无累计误差）
    this.x = Math.min(Math.max(this.x + (e.clientX - this.prevX), this.gap), innerWidth - this.w - this.gap)
    this.y = Math.min(Math.max(this.y + (e.clientY - this.prevY), this.gap), innerHeight - this.h - this.gap)
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

  /** 吸附间距换算：0.875rem 转 px（随根字号缩放，与 .hud 间距一致） */
  private updateGap() {
    this.gap = 0.875 * parseFloat(getComputedStyle(document.documentElement).fontSize)
  }

  /** 松手/视口变化后吸附到最近的一条边（另一维保持），带缓动动画 */
  private snapToEdge() {
    const r = this.getBoundingClientRect()
    const g = this.gap
    const vw = innerWidth
    const vh = innerHeight
    const dRight = vw - r.right - g
    const dBottom = vh - r.bottom - g
    const min = Math.min(r.left - g, dRight, r.top - g, dBottom)
    let tx = r.left
    let ty = r.top
    if (min === r.left - g) tx = g
    else if (min === dRight) tx = vw - r.width - g
    else if (min === r.top - g) ty = g
    else ty = vh - r.height - g
    if (tx === r.left && ty === r.top) return
    this.style.transition = 'transform 360ms cubic-bezier(0.22, 1, 0.36, 1)'
    this.applyTransform(tx, ty)
  }

  /** 位置经 transform 表达（相对 CSS 定位的偏移，合成器线程移动） */
  private applyTransform(x: number, y: number) {
    this.style.transform = `translate(${x - this.originX}px, ${y - this.originY}px)`
  }

  private refresh() {
    const n = this.frames
    const sorted = [...this.intervals].sort((a, b) => a - b)
    const p = (q: number) => {
      const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q))
      return idx < 0 ? '—' : sorted[idx].toFixed(1)
    }
    const mean = sorted.length > 0 ? sorted.reduce((s, v) => s + v, 0) / sorted.length : 0
    const fps = mean > 0 ? (1000 / mean).toFixed(0) : '—'
    const last = this.last
    const mb = last ? (last.uploadBytes / 1024 / 1024).toFixed(2) : '—'
    this.text = `${fps} fps · p95 ${p(0.95)}ms · tick ${(this.tickSum / n).toFixed(2)} · batch ${(this.batchSum / n).toFixed(2)} · ${last ? last.vertices : '—'}v ${mb}MB`
    this.requestUpdate()
    this.intervals.length = 0
    this.frames = 0
    this.tickSum = 0
    this.batchSum = 0
    this.lastAt = 0
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sf-perf': SfPerf
  }
}
