import { GameLoop } from '../core/loop'
import { sfx } from '../core/sfx'
import { PerformanceGovernor, TRACER_TIERS, DPR_TIERS } from '../core/governor'
import { buildWindProbes, isLanding, sampleWind } from '../core/wind'
import { Tracers, TRAIL_LEN } from '../sim/particles'
import { Clouds } from '../sim/clouds'
import { Trail } from '../sim/trail'
import type { SourceKind } from '../sim/types'
import { LevelSimulation } from '../game/simulation'
import type { HudState, LevelDef, PressVisual, SourcePlacement } from '../game/types'
import { GestureInput } from './input'
import { Renderer } from '../render/render'
import { createEngine, type EngineHandle } from '../wasm/engine'
import { SfStatusBar } from './status-bar'
import { urlState } from '../game/state'
import { penaltySeconds } from '../game/timer'
import type { DevTools } from '../dev/devtools'

const PLANE_TRAIL_MAX_POINTS = 150
const PLANE_TRAIL_SAMPLE = 0.3
const PLANE_TRAIL_FADE = 6
const LAND_SOUND_MIN_INTERVAL = 150
export interface ControllerEvents {
  onHud(state: HudState): void
  onDeny(kind: SourceKind): void
  onSources?(sources: SourcePlacement[]): void
}

export class GameController {
  private sim: LevelSimulation
  private engine: EngineHandle
  private tracers: Tracers
  private clouds: Clouds
  private planeTrail: Trail
  private renderer: Renderer
  private loop: GameLoop
  private input: GestureInput
  private events: ControllerEvents
  private host: HTMLElement
  private ro: ResizeObserver | null = null
  private press: PressVisual | null = null
  private lastPhase: 'playing' | 'won' = 'playing'
  private windProbes: { x: number; y: number }[]
  private tmpAir = { x: 0, y: 0 }
  private governor: PerformanceGovernor
  private tickMs = 0
  private lastLand = -Infinity
  private rate = 1
  private fitW = 0
  private fitH = 0
  private world: { w: number; h: number }
  private ground: (x: number) => number
  private devTools: DevTools | null = null
  private statusEl: SfStatusBar | null = null

  constructor(
    canvas: HTMLCanvasElement,
    level: LevelDef,
    events: ControllerEvents,
    host?: HTMLElement,
    devTools?: DevTools | null,
  ) {
    this.events = events
    this.host = host ?? canvas.parentElement ?? canvas
    this.world = level.world
    this.ground = level.ground
    // 物理与渲染共享同一 wasm 实例：渲染零拷贝读流体内存（每关一次，keyed 重建时整体释放）
    this.engine = createEngine()
    this.sim = new LevelSimulation(level, this.engine)
    if (urlState.get('dev')) this.sim.unlimited = true
    this.devTools = devTools ?? null
    // 挂 document.body：sf-game 无 slot，挂宿主 light DOM 不可见
    const status = new SfStatusBar()
    status.setLevel(level.id, level.name)
    document.body.appendChild(status)
    this.statusEl = status
    // 各平台同参数起步，视觉一致；性能不足时由 governor 按实测自适应降档（所有平台同一策略）
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    this.governor = new PerformanceGovernor(TRACER_TIERS, DPR_TIERS, {
      initialTracerLevel: reduced ? TRACER_TIERS.length - 1 : 0,
    })
    this.tracers = new Tracers(
      TRACER_TIERS[this.governor.tracerLevel],
      this.world,
      this.ground,
      TRAIL_LEN,
    )
    this.clouds = new Clouds(level.id, this.world, this.ground)
    this.planeTrail = new Trail(PLANE_TRAIL_MAX_POINTS, PLANE_TRAIL_SAMPLE, PLANE_TRAIL_FADE)
    const { w, h } = level.world
    this.windProbes = buildWindProbes(w, h)
    this.renderer = new Renderer(canvas, this.engine)
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
          this.emitSources()
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
  }

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

  setRate(rate: number) {
    this.rate = rate
    this.loop.setRate(rate)
  }

  destroy() {
    this.loop.stop()
    this.input.destroy()
    this.ro?.disconnect()
    this.ro = null
    window.removeEventListener('resize', this.fit)
    this.statusEl?.remove()
    this.statusEl = null
    sfx.fadeOutWind()
  }

  restart() {
    this.sim.restart()
    this.planeTrail.clear()
    this.press = null
    this.lastPhase = 'playing'
    this.pushHud()
    this.devTools?.syncPause(this.sim.paused)
  }

  togglePause() {
    this.sim.setPaused(!this.sim.paused)
    if (this.sim.paused) sfx.fadeOutWind()
    this.devTools?.syncPause(this.sim.paused)
    this.pushHud()
  }

  private pushHud() {
    this.events.onHud(this.sim.hudState())
  }

  private pixelRatio(): number {
    return this.governor.pixelRatio(window.devicePixelRatio || 1)
  }

  private fit = () => {
    const rect = this.host.getBoundingClientRect()
    const w = Math.round(rect.width)
    const h = Math.round(rect.height)
    // 任一边为 0（布局瞬态）跳过：会算出 NaN/Inf 视口坐标并在 drawTerrain 抛 RangeError
    if (w === 0 || h === 0) return
    // 尺寸未变跳过：防 ResizeObserver 抖动导致画布每帧重建（iOS 已知坑）
    if (w === this.fitW && h === this.fitH) return
    this.fitW = w
    this.fitH = h
    // 画布铺满宿主，世界 contain 后界外由渲染器以天空外推填充（取景宽容：宽屏/竖屏均满屏）
    this.renderer.resize(w, h, this.pixelRatio())
    // canvas 尺寸变更会重置 WebGL 缓冲（黑屏）：补画一帧防首帧黑闪
    this.render()
  }

  private tryPlace(x: number, y: number, kind: SourceKind) {
    this.press = null
    const source = this.sim.placeSource(x, y, kind)
    if (source) {
      if (kind === 'hot') sfx.placeHot()
      else sfx.placeCold()
      this.pushHud()
      this.emitSources()
    } else {
      sfx.deny()
      this.events.onDeny(kind)
    }
  }

  // silent = 挂载初始应用，不回写 URL（避免多余历史条目）
  applySources(list: SourcePlacement[], silent = false) {
    // 胜利结算让位：若仍满足胜利条件，下一帧会重新判定
    if (this.sim.phase === 'won') this.sim.phase = 'playing'
    this.sim.applySources(list)
    this.pushHud()
    if (!silent) this.emitSources()
  }

  private emitSources() {
    // 对齐 URL 精度（1 位小数），保证往返稳定、等值跳过生效
    this.events.onSources?.(
      this.sim.sources.map((s) => ({
        x: Math.round(s.x * 10) / 10,
        y: Math.round(s.y * 10) / 10,
        kind: s.kind,
      })),
    )
  }

  private tick = (dt: number) => {
    const t0 = performance.now()
    const frozen = this.sim.paused || this.sim.phase === 'won'
    const visitedBefore = this.sim.visitedCount

    if (!frozen) {
      const p = this.sim.plane
      const altBefore = this.sim.level.ground(p.x) - p.y
      const vyBefore = p.vy

      this.sim.step(dt)
      this.tracers.step(dt, this.sim.fluid, this.sim.sources)
      this.clouds.step(dt, this.sim.fluid)
      this.planeTrail.push(p.x, p.y, this.sim.time)

      const wind = sampleWind(this.sim.fluid, this.windProbes, p, this.tmpAir)
      sfx.updateWind(wind.field, wind.rel, dt)
      sfx.setPlanePan(p.x, this.world.w)
      const altAfter = this.sim.level.ground(p.x) - p.y
      if (isLanding(altBefore, altAfter, vyBefore)) {
        const now = performance.now()
        if (now - this.lastLand > LAND_SOUND_MIN_INTERVAL) {
          this.lastLand = now
          sfx.land(Math.abs(vyBefore))
        }
      }
    }

    if (this.sim.visitedCount > visitedBefore) {
      if (this.sim.phase === 'won') sfx.win()
      else sfx.reward()
    }

    if (this.sim.phase !== this.lastPhase) {
      this.lastPhase = this.sim.phase
      if (this.sim.phase === 'won') sfx.fadeOutWind()
      this.pushHud()
    }

    this.tickMs += performance.now() - t0
  }

  private render = () => {
    const t0 = performance.now()
    this.renderer.draw({
      sim: this.sim,
      tracers: this.tracers,
      clouds: this.clouds,
      planeTrail: this.planeTrail,
      press: this.press,
      now: performance.now(),
    })
    // 每帧直推：文本不变时组件内短路，零开销
    this.statusEl?.refresh(this.sim.time, penaltySeconds(this.sim.sources.length))
    this.devTools?.record({
      tickMs: this.tickMs,
      batchMs: performance.now() - t0,
      vertices: this.renderer.lastVertexCount,
      uploadBytes: this.renderer.lastUploadBytes,
      tracers: this.tracers.count,
      dpr: this.pixelRatio(),
    })
    const cost = performance.now() - t0 + this.tickMs
    this.tickMs = 0
    // 降级执行留在 controller（tracers 重建 / fit 涉及模拟与渲染对象）
    const action = this.governor.record(cost, this.rate)
    if (action === 'tracer') {
      this.tracers = new Tracers(
        TRACER_TIERS[this.governor.tracerLevel],
        this.world,
        this.ground,
        TRAIL_LEN,
      )
    } else if (action === 'dpr') {
      this.fit()
    }
  }
}
