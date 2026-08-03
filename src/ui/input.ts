import type { Vec2 } from '../sim/types'
import type { Source } from './types'

/** 长按判定阈值（毫秒）：超过即确认为冷源。 */
export const LONG_PRESS_MS = 380

/** 位移超过该像素值视为"移动"，取消轻点/长按语义（可拖离以撤销）。 */
const MOVE_SLOP_PX = 14

export interface GestureHandlers {
  /** client 坐标 → 世界坐标；落在可玩区域外返回 null */
  toWorld(clientX: number, clientY: number): Vec2 | null
  /** 按压起点命中了已有源（进入移除手势） */
  hitSource(w: Vec2): Source | null
  sourceGrabbed(source: Source): void
  sourceReleased(source: Source): void
  pressStarted(w: Vec2): void
  /** 长按达到阈值，确认放置冷源 */
  longPressConfirmed(w: Vec2): void
  /** 轻点（快速抬起），确认放置热源 */
  tap(w: Vec2): void
  pressCancelled(): void
  /** 桌面端右键 = 直接放冷源 */
  secondaryTap(w: Vec2): void
}

interface PointerTrack {
  startClientX: number
  startClientY: number
  world: Vec2
  source: Source | null
  moved: boolean
  longFired: boolean
  timer: number
}

/**
 * 统一指针手势（Pointer Events，兼容鼠标/触摸/触控笔）：
 * - 轻点空白 = 热源；长按空白 = 冷源（达阈值即确认）
 * - 按住已有源并抬起 = 移除；拖离原位可撤销
 * 反馈必须从 pointerdown 即刻开始（由渲染层依据 pressStarted 时间绘制进度环）。
 */
export class GestureInput {
  private el: HTMLElement
  private handlers: GestureHandlers
  private pointers = new Map<number, PointerTrack>()

  constructor(el: HTMLElement, handlers: GestureHandlers) {
    this.el = el
    this.handlers = handlers
    el.addEventListener('pointerdown', this.onDown)
    el.addEventListener('pointermove', this.onMove)
    el.addEventListener('pointerup', this.onUp)
    el.addEventListener('pointercancel', this.onCancel)
    el.addEventListener('contextmenu', this.onContextMenu)
  }

  destroy() {
    const el = this.el
    el.removeEventListener('pointerdown', this.onDown)
    el.removeEventListener('pointermove', this.onMove)
    el.removeEventListener('pointerup', this.onUp)
    el.removeEventListener('pointercancel', this.onCancel)
    el.removeEventListener('contextmenu', this.onContextMenu)
    for (const p of this.pointers.values()) clearTimeout(p.timer)
    this.pointers.clear()
  }

  private onContextMenu = (e: Event) => {
    e.preventDefault()
    const me = e as PointerEvent
    const w = this.handlers.toWorld(me.clientX, me.clientY)
    if (!w) return
    if (!this.handlers.hitSource(w)) this.handlers.secondaryTap(w)
  }

  private onDown = (e: PointerEvent) => {
    // 只处理主键（左键/触摸）。右键由 contextmenu 走"直接放冷源"路径，
    // 若在此放行，右键会先按热源 tap 流程放置热源，与设计冲突。
    if (e.button !== 0) return
    const w = this.handlers.toWorld(e.clientX, e.clientY)
    if (!w) return
    this.el.setPointerCapture(e.pointerId)
    const source = this.handlers.hitSource(w)
    const track: PointerTrack = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      world: w,
      source,
      moved: false,
      longFired: false,
      timer: 0,
    }
    if (source) {
      this.handlers.sourceGrabbed(source)
    } else {
      this.handlers.pressStarted(w)
      track.timer = window.setTimeout(() => {
        track.longFired = true
        this.handlers.longPressConfirmed(track.world)
        this.handlers.pressCancelled()
        this.pointers.delete(e.pointerId)
      }, LONG_PRESS_MS)
    }
    this.pointers.set(e.pointerId, track)
  }

  private onMove = (e: PointerEvent) => {
    const track = this.pointers.get(e.pointerId)
    if (!track || track.moved) return
    const dx = e.clientX - track.startClientX
    const dy = e.clientY - track.startClientY
    if (dx * dx + dy * dy < MOVE_SLOP_PX * MOVE_SLOP_PX) return
    track.moved = true
    clearTimeout(track.timer)
    this.handlers.pressCancelled()
    this.pointers.delete(e.pointerId)
  }

  private onUp = (e: PointerEvent) => {
    const track = this.pointers.get(e.pointerId)
    if (!track) return
    this.pointers.delete(e.pointerId)
    clearTimeout(track.timer)
    if (track.longFired || track.moved) return
    if (track.source) {
      this.handlers.sourceReleased(track.source)
    } else {
      this.handlers.tap(track.world)
      this.handlers.pressCancelled()
    }
  }

  private onCancel = (e: PointerEvent) => {
    const track = this.pointers.get(e.pointerId)
    if (!track) return
    this.pointers.delete(e.pointerId)
    clearTimeout(track.timer)
    this.handlers.pressCancelled()
  }
}
