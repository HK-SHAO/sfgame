import { GameLoop } from '../core/loop'
import { sfx } from '../core/sfx'
import { Tracers, TRAIL_LEN } from '../sim/particles'
import { Clouds } from '../sim/clouds'
import { Trail } from '../sim/trail'
import type { SourceKind } from '../sim/types'
import { LevelSimulation } from '../game/simulation'
import type { HudState, LevelDef, PressVisual, SourcePlacement } from '../game/types'
import { GestureInput } from './input'
import { Renderer } from '../render/render'
import { SfStatusBar } from './status-bar'
import { urlState } from '../game/state'
import { penaltySeconds } from '../game/timer'
import type { DevTools } from '../dev/devtools'

// 粒子数消耗 CPU 采样预算（渲染已 GPU 化），按模拟成本分档降级
const TRACER_TIERS = [400, 320, 240, 180, 128, 96]
const COARSE_TRACER_TIER = 2
const PLANE_TRAIL_MAX_POINTS = 150
const PLANE_TRAIL_SAMPLE = 0.3
const PLANE_TRAIL_FADE = 6
const WIND_PROBE_FX = [0.22, 0.5, 0.78]
const WIND_PROBE_FY = [0.2, 0.35]
const LAND_ALT_BEFORE = 0.9
const LAND_ALT_AFTER = 0.55
const LAND_IMPACT_MIN = 0.8
const LAND_SOUND_MIN_INTERVAL = 150
// dpr 降档是持续过载的最后手段（GPU 栅格化负载）
const DPR_TIERS_COARSE = [2, 1.5, 1.0]
const DPR_TIERS_FINE = [2, 1.5]
// 持续超限才降级，避免偶发卡顿误触发
const SLOW_FRAMES_TO_DEGRADE = 150
// 60fps 预算 16.7ms，留余量
const FRAME_BUDGET_MS = 13
const FRAME_EMA_SMOOTH = 0.95
export interface ControllerEvents {
  onHud(state: HudState): void
  onDeny(kind: SourceKind): void
  onSources?(sources: SourcePlacement[]): void
}

export class GameController {
  private sim: LevelSimulation
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
  private tracerLevel: number
  private dprTier = 0
  private dprTiers: number[]
  private frameEma = 0
  private slowFrames = 0
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
    this.sim = new LevelSimulation(level)
    if (urlState.get('dev')) this.sim.unlimited = true
    this.devTools = devTools ?? null
    // 挂 document.body：sf-game 无 slot，挂宿主 light DOM 不可见
    const status = new SfStatusBar()
    status.setLevel(level.id, level.name)
    document.body.appendChild(status)
    this.statusEl = status
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const coarse = window.matchMedia('(pointer: coarse)').matches
    this.dprTiers = coarse ? DPR_TIERS_COARSE : DPR_TIERS_FINE
    this.tracerLevel = reduced
      ? TRACER_TIERS.length - 1
      : coarse
        ? COARSE_TRACER_TIER
        : 0
    this.tracers = new Tracers(
      TRACER_TIERS[this.tracerLevel],
      this.world,
      this.ground,
      TRAIL_LEN,
    )
    this.clouds = new Clouds(level.id, this.world, this.ground)
    this.planeTrail = new Trail(PLANE_TRAIL_MAX_POINTS, PLANE_TRAIL_SAMPLE, PLANE_TRAIL_FADE)
    const { w, h } = level.world
    this.windProbes = WIND_PROBE_FX.flatMap((fx) =>
      WIND_PROBE_FY.map((fy) => ({ x: fx * w, y: fy * h })),
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
    return Math.min(window.devicePixelRatio || 1, this.dprTiers[this.dprTier])
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

      sfx.updateWind(this.fieldWind(), this.planeRelWind(), dt)
      sfx.setPlanePan(p.x, this.world.w)
      const altAfter = this.sim.level.ground(p.x) - p.y
      if (altBefore > LAND_ALT_BEFORE && altAfter <= LAND_ALT_AFTER && Math.abs(vyBefore) > LAND_IMPACT_MIN) {
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

  private planeRelWind(): number {
    const p = this.sim.plane
    this.sim.fluid.sampleVelocity(p.x, p.y, this.tmpAir)
    return Math.hypot(p.vx - this.tmpAir.x, p.vy - this.tmpAir.y)
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
      loopFrames: this.loop.frameCount,
      loopRenders: this.loop.renderCount,
    })
    const cost = performance.now() - t0 + this.tickMs
    this.tickMs = 0
    this.frameEma = this.frameEma === 0 ? cost : this.frameEma * FRAME_EMA_SMOOTH + cost * (1 - FRAME_EMA_SMOOTH)
    // 预算随速率放大（1× 下限）：倍速慢帧是预期，且流体成本不可降级
    if (this.frameEma > FRAME_BUDGET_MS * Math.max(1, this.rate)) {
      // 先降粒子（观感影响小），到底仍不够再降 dpr
      if (++this.slowFrames > SLOW_FRAMES_TO_DEGRADE) {
        this.slowFrames = 0
        if (this.tracerLevel < TRACER_TIERS.length - 1) {
          this.tracerLevel++
          this.tracers = new Tracers(
            TRACER_TIERS[this.tracerLevel],
            this.world,
            this.ground,
            TRAIL_LEN,
          )
        } else if (this.dprTier < this.dprTiers.length - 1) {
          this.dprTier++
          this.fit()
        }
      }
    } else {
      this.slowFrames = 0
    }
  }
}
