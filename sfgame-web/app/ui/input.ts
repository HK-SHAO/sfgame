import { LONG_PRESS_MS, type SourceKind, type Vec2 } from '../sim/types'
import type { Source } from '../game/types'

const MOVE_SLOP_PX = 14

export interface GestureHandlers {
  toWorld(clientX: number, clientY: number): Vec2 | null
  hitSource(w: Vec2): Source | null
  sourceGrabbed(source: Source): void
  sourceReleased(source: Source): void
  pressStarted(w: Vec2): void
  longPressConfirmed(w: Vec2, clientX: number, clientY: number): void
  tap(w: Vec2, clientX: number, clientY: number): void
  pressCancelled(): void
  secondaryTap(w: Vec2, clientX: number, clientY: number): void
  // 点击落在世界盒外（letterbox 天空带等）无法映射坐标：仍按按钮意图给统一 deny 反馈
  denyAt(kind: SourceKind, clientX: number, clientY: number): void
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
    if (!w) {
      this.handlers.denyAt('cold', me.clientX, me.clientY)
      return
    }
    if (!this.handlers.hitSource(w)) this.handlers.secondaryTap(w, me.clientX, me.clientY)
  }

  private onDown = (e: PointerEvent) => {
    // 右键走 contextmenu 放冷源；此处放行会先按 tap 放热源
    if (e.button !== 0) return
    const w = this.handlers.toWorld(e.clientX, e.clientY)
    if (!w) {
      // 世界盒外（letterbox 带）按左键意图给热源 deny
      this.handlers.denyAt('hot', e.clientX, e.clientY)
      return
    }
    // 个别环境（自动化/合成事件等）pointer 未激活时 capture 会抛，退化为普通手势
    try {
      this.el.setPointerCapture(e.pointerId)
    } catch {
    }
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
        this.handlers.longPressConfirmed(track.world, track.startClientX, track.startClientY)
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
      this.handlers.tap(track.world, e.clientX, e.clientY)
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
