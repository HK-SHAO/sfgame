import { GameLoop } from '../core/loop'
import { sfx } from '../core/sfx'
import { Tracers } from '../sim/particles'
import type { SourceKind } from '../sim/types'
import { GestureInput } from './input'
import { Renderer } from './render'
import { LevelSimulation } from './simulation'
import type { HudState, LevelDef, PressVisual } from './types'

export interface ControllerEvents {
  onHud(state: HudState): void
  /** 放置被拒绝（预算耗尽或位置无效），供 HUD 抖动提示 */
  onDeny(kind: SourceKind): void
}

/**
 * 游戏控制器：把无头模拟（Simulation）、渲染、手势输入与音效组装起来。
 * Lit 层只负责画布之外的 UI，并通过事件接收 HUD 状态。
 */
export class GameController {
  private sim: LevelSimulation
  private tracers: Tracers
  private renderer: Renderer
  private loop: GameLoop
  private input: GestureInput
  private events: ControllerEvents
  private canvas: HTMLCanvasElement
  /** 尺寸适配宿主：画布随其缩放。默认取画布的父元素（light DOM 下可用）。 */
  private host: HTMLElement
  private ro: ResizeObserver | null = null
  private press: PressVisual | null = null
  private lastPhase: 'playing' | 'won' = 'playing'

  constructor(
    canvas: HTMLCanvasElement,
    level: LevelDef,
    events: ControllerEvents,
    host?: HTMLElement,
  ) {
    this.canvas = canvas
    this.events = events
    this.host = host ?? canvas.parentElement ?? canvas
    this.sim = new LevelSimulation(level)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    this.tracers = new Tracers(
      reduced ? 110 : 320,
      { w: level.world.w, h: level.world.h },
      level.ground,
    )
    this.renderer = new Renderer(canvas)
    this.loop = new GameLoop({ tick: this.tick, render: this.render })
    this.input = new GestureInput(canvas, {
      toWorld: (cx, cy) => this.renderer.toWorld(cx, cy),
      hitSource: (w) => this.sim.hitSource(w.x, w.y),
      sourceGrabbed: (s) => {
        this.press = {
          kind: 'remove',
          x: s.x,
          y: s.y,
          start: performance.now(),
          sourceId: s.id,
        }
      },
      sourceReleased: (s) => {
        this.press = null
        if (this.sim.removeSource(s.id)) {
          sfx.remove()
          this.pushHud()
        }
      },
      pressStarted: (w) => {
        this.press = { kind: 'place', x: w.x, y: w.y, start: performance.now() }
      },
      longPressConfirmed: (w) => this.tryPlace(w.x, w.y, 'cold'),
      tap: (w) => this.tryPlace(w.x, w.y, 'hot'),
      pressCancelled: () => {
        this.press = null
      },
      secondaryTap: (w) => this.tryPlace(w.x, w.y, 'cold'),
    })
    canvas.addEventListener('pointerdown', this.unlockAudio)
  }

  private unlockAudio = () => sfx.unlock()

  start() {
    if ('ResizeObserver' in window) {
      this.ro = new ResizeObserver(() => this.fit())
      this.ro.observe(this.host)
    }
    this.fit()
    window.addEventListener('resize', this.fit)
    this.loop.start()
    this.pushHud()
  }

  destroy() {
    this.loop.stop()
    this.input.destroy()
    this.ro?.disconnect()
    this.ro = null
    window.removeEventListener('resize', this.fit)
    this.canvas.removeEventListener('pointerdown', this.unlockAudio)
  }

  reset() {
    this.sim.reset()
    this.press = null
    this.lastPhase = 'playing'
    this.pushHud()
  }

  private pushHud() {
    this.events.onHud(this.sim.hudState())
  }

  private fit = () => {
    const rect = this.host.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.renderer.resize(rect.width, rect.height, dpr)
  }

  private tryPlace(x: number, y: number, kind: SourceKind) {
    this.press = null
    const source = this.sim.placeSource(x, y, kind)
    if (source) {
      if (kind === 'hot') sfx.placeHot()
      else sfx.placeCold()
      this.pushHud()
    } else {
      sfx.deny()
      this.events.onDeny(kind)
    }
  }

  private tick = (dt: number) => {
    this.sim.step(dt)
    this.tracers.step(dt, this.sim.fluid, this.sim.sources)
    if (this.sim.phase !== this.lastPhase) {
      this.lastPhase = this.sim.phase
      if (this.sim.phase === 'won') sfx.win()
      this.pushHud()
    }
  }

  private render = () => {
    this.renderer.draw({
      sim: this.sim,
      tracers: this.tracers,
      press: this.press,
      now: performance.now(),
    })
  }
}
