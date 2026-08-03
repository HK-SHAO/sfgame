import { GameLoop } from '../core/loop'
import { sfx } from '../core/sfx'
import { Tracers } from '../sim/particles'
import { Trail } from '../sim/trail'
import type { SourceKind } from '../sim/types'
import { LevelSimulation } from '../game/simulation'
import type { HudState, LevelDef, PressVisual } from '../game/types'
import { GestureInput } from './input'
import { Renderer } from './render'

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
  /** 纸飞机拖尾：按路程淡出，停驻时轨迹保留 */
  private planeTrail: Trail
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
  /** 风场采样探针（世界坐标，关卡尺度的固定比例点） */
  private windProbes: { x: number; y: number }[]
  private tmpAir = { x: 0, y: 0 }

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
    this.planeTrail = new Trail(150, 0.3, 42)
    const { w, h } = level.world
    this.windProbes = [0.22, 0.5, 0.78].flatMap((fx) =>
      [0.2, 0.35].map((fy) => ({ x: fx * w, y: fy * h })),
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
    this.planeTrail.clear()
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
    const p = this.sim.plane
    const altBefore = this.sim.level.ground(p.x) - p.y
    const vyBefore = p.vy

    this.sim.step(dt)
    this.tracers.step(dt, this.sim.fluid, this.sim.sources)
    this.planeTrail.push(p.x, p.y)

    // 物理音效：底噪随全场风速，摩擦声随飞机相对空气的速度
    sfx.updateWind(this.fieldWind(), this.planeRelWind(), dt)
    const altAfter = this.sim.level.ground(p.x) - p.y
    if (altBefore > 0.9 && altAfter <= 0.55 && Math.abs(vyBefore) > 0.8) {
      sfx.land(Math.abs(vyBefore))
    }

    if (this.sim.phase !== this.lastPhase) {
      this.lastPhase = this.sim.phase
      if (this.sim.phase === 'won') sfx.win()
      this.pushHud()
    }
  }

  /** 全场代表风速：固定探针 + 飞机位置处的风速均值 */
  private fieldWind(): number {
    const fluid = this.sim.fluid
    let sum = 0
    for (const pr of this.windProbes) {
      fluid.sampleVelocity(pr.x, pr.y, this.tmpAir)
      sum += Math.hypot(this.tmpAir.x, this.tmpAir.y)
    }
    const p = this.sim.plane
    fluid.sampleVelocity(p.x, p.y, this.tmpAir)
    sum += Math.hypot(this.tmpAir.x, this.tmpAir.y)
    return sum / (this.windProbes.length + 1)
  }

  /** 飞机相对空气的速度：摩擦声的物理来源（随风同飘时近乎无声） */
  private planeRelWind(): number {
    const p = this.sim.plane
    this.sim.fluid.sampleVelocity(p.x, p.y, this.tmpAir)
    return Math.hypot(p.vx - this.tmpAir.x, p.vy - this.tmpAir.y)
  }

  private render = () => {
    this.renderer.draw({
      sim: this.sim,
      tracers: this.tracers,
      planeTrail: this.planeTrail,
      press: this.press,
      now: performance.now(),
    })
  }
}
