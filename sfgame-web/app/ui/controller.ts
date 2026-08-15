import { GameLoop, SIM_DT } from '../core/loop.ts'
import { sfx } from '../core/sfx.ts'
import { bgm } from '../core/bgm.ts'
import { fb } from '../core/feedback.ts'
import { governor } from '../core/governor.ts'
import { terrainFromField } from '../sim/terrain.ts'
import { TRAIL_LEN } from '../sim/particles.ts'
import type { PressVisual, SourceKind } from '../sim/types.ts'
import type { HudState, LevelDef, Source, SourcePlacement } from '../game/types.ts'
import { GestureInput } from './input.ts'
import { Renderer, type RenderView } from '../render/render.ts'
import { createEngine, type EngineHandle } from '../wasm/engine.ts'
import type { PerfRecorder } from '../dev/devtools.ts'
import type { FrameSnapshot, SimEvent, SimRequest, SimViews } from '../sim/worker-protocol.ts'
import { SOURCE_HIT_RADIUS, TRACER_COUNT } from '../sim/worker-protocol.ts'

export interface ControllerEvents {
  onHud(state: HudState): void
  onDeny(kind: SourceKind, clientX: number, clientY: number): void
  onSources(sources: SourcePlacement[]): void
  onStatus(time: number, extra: number): void
}

export class GameController {
  private renderer: Renderer
  private engine: EngineHandle
  private worker: Worker
  private loop: GameLoop
  private input: GestureInput
  private events: ControllerEvents
  private host: HTMLElement
  private ro: ResizeObserver | null = null
  private press: PressVisual | null = null
  private devTools: PerfRecorder | null = null
  private tickMs = 0
  private rate = 1
  private fitW = 0
  private fitH = 0
  private ready = false
  private snapshot: FrameSnapshot | null = null
  private staticView: {
    world: { w: number; h: number }
    terrain: ReturnType<typeof terrainFromField>
    goals: RenderView['goals']
    fixedSources: RenderView['fixedSources']
    fans: RenderView['fans']
    views: SimViews | null
  } | null = null
  private paused = false
  private suppressSources = false
  private world: { w: number; h: number }

  constructor(
    canvas: HTMLCanvasElement,
    level: LevelDef,
    events: ControllerEvents,
    host?: HTMLElement,
    devTools?: PerfRecorder | null,
  ) {
    this.events = events
    this.host = host ?? canvas.parentElement ?? canvas
    this.world = level.world
    this.devTools = devTools ?? null
    this.engine = createEngine()
    this.renderer = new Renderer(canvas, this.engine)
    this.worker = new Worker(new URL('../sim/sim-worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = this.onWorkerMessage
    this.worker.onerror = (e) => {
      console.error('模拟 worker 启动失败：', e.message)
      this.loop.stop()
    }
    this.loop = new GameLoop({ tick: this.tick, render: this.render })
    this.input = new GestureInput(canvas, {
      toWorld: (cx, cy) => this.renderer.toWorld(cx, cy),
      hitSource: (w) => this.hitSource(w.x, w.y),
      sourceGrabbed: (s) => {
        fb.grab()
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
        this.send({ t: 'remove', id: s.id })
      },
      pressStarted: (w) => {
        this.press = { kind: 'place', x: w.x, y: w.y, start: performance.now() }
      },
      longPressConfirmed: (w, cx, cy) => this.tryPlace(w.x, w.y, 'cold', cx, cy),
      tap: (w, cx, cy) => this.tryPlace(w.x, w.y, 'hot', cx, cy),
      pressCancelled: () => {
        this.press = null
      },
      secondaryTap: (w, cx, cy) => this.tryPlace(w.x, w.y, 'cold', cx, cy),
      denyAt: (kind, cx, cy) => this.deny(kind, cx, cy),
    })
    this.send({ t: 'load', levelId: level.id, json: level.json, unlimited: this.devTools !== null })
  }

  start() {
    if ('ResizeObserver' in window) {
      this.ro = new ResizeObserver(() => this.fit())
      this.ro.observe(this.host)
    }
    this.fit()
    this.loop.start()
  }

  get renderable(): boolean {
    return this.renderer.available
  }

  setRate(rate: number) {
    this.rate = rate
    this.loop.setRate(rate)
  }

  destroy() {
    this.loop.stop()
    this.worker.terminate()
    this.worker.onmessage = null
    this.worker.onerror = null
    this.input.destroy()
    this.ro?.disconnect()
    this.ro = null
    sfx.fadeOutWind()
    bgm.setPaused(false)
    this.renderer.dispose()
  }

  restart() {
    this.send({ t: 'restart' })
    bgm.setPaused(false)
    this.press = null
  }

  togglePause() {
    this.send({ t: 'pause', v: !this.paused })
  }

  applySources(list: SourcePlacement[], silent = false) {
    this.suppressSources = silent
    this.send({ t: 'applySources', list })
  }

  private send(msg: SimRequest) {
    this.worker.postMessage(msg)
  }

  private pixelRatio(): number {
    return governor.pixelRatio(window.devicePixelRatio || 1)
  }

  private fit = (force = false) => {
    const rect = this.host.getBoundingClientRect()
    const w = Math.round(rect.width)
    const h = Math.round(rect.height)
    if (w === 0 || h === 0) return
    if (!force && w === this.fitW && h === this.fitH) return
    this.fitW = w
    this.fitH = h
    this.renderer.resize(w, h, this.pixelRatio())
    this.render()
  }

  private deny(kind: SourceKind, clientX: number, clientY: number) {
    fb.deny()
    this.events.onDeny(kind, clientX, clientY)
  }

  private tryPlace(x: number, y: number, kind: SourceKind, clientX: number, clientY: number) {
    this.press = null
    this.send({ t: 'place', x, y, kind, clientX, clientY })
  }

  private hitSource(x: number, y: number): Source | null {
    const sources = this.snapshot?.sources
    if (!sources) return null
    let best: Source | null = null
    let bestDist = SOURCE_HIT_RADIUS
    for (const s of sources) {
      const dx = s.x - x
      const dy = s.y - y
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d < bestDist) {
        bestDist = d
        best = s
      }
    }
    return best
  }

  private tick = (dt: number) => {
    if (!this.ready) return
    this.send({ t: 'tick', dt })
  }

  private render = () => {
    const t0 = performance.now()
    const snap = this.snapshot
    const st = this.staticView
    if (!snap || !st) {
      this.renderer.drawBoot(this.world)
      return
    }
    const view: RenderView = {
      ...st,
      time: snap.time,
      plane: snap.plane,
      sources: snap.sources,
      visited: snap.visited,
      clouds: snap.clouds,
      planeTrail: snap.planeTrail,
      ambient: snap.ambient,
    }
    this.renderer.draw({ view, press: this.press, now: performance.now() })
    this.events.onStatus(snap.time, snap.extra)
    this.devTools?.record({
      tickMs: this.tickMs,
      batchMs: performance.now() - t0,
      vertices: this.renderer.lastVertexCount,
      uploadBytes: this.renderer.lastUploadBytes,
      tracers: TRACER_COUNT,
      dpr: this.pixelRatio(),
    })
    const cost = performance.now() - t0 + this.tickMs
    this.tickMs = 0
    if (governor.record(cost, this.rate)) this.fit(true)
  }

  private onWorkerMessage = (e: MessageEvent<SimEvent>) => {
    const m = e.data
    switch (m.t) {
      case 'ready':
        this.onReady(m)
        break
      case 'frame':
        this.tickMs += m.snapshot.tickMs
        this.snapshot = m.snapshot
        break
      case 'hud':
        this.onHud(m.state)
        break
      case 'phase':
        if (m.phase === 'won') sfx.fadeOutWind()
        break
      case 'visited':
        if (m.won) fb.win()
        else fb.reward()
        break
      case 'placed':
        if (m.kind === 'hot') fb.placeHot()
        else fb.placeCold()
        break
      case 'removed':
        fb.remove()
        break
      case 'deny':
        this.deny(m.kind, m.clientX, m.clientY)
        break
      case 'wind':
        sfx.updateWind(m.field, m.rel, SIM_DT)
        sfx.setPlanePan(m.px, this.world.w)
        break
      case 'land':
        fb.land(m.intensity)
        break
      case 'sources':
        if (this.suppressSources) {
          this.suppressSources = false
          break
        }
        this.events.onSources(m.list)
        break
    }
  }

  private onReady(m: Extract<SimEvent, { t: 'ready' }>) {
    const { nx, ny, cell, originX, field } = m.terrain
    this.staticView = {
      world: m.world,
      terrain: terrainFromField(field, { nx, ny, origin: originX }, cell),
      goals: m.goals,
      fixedSources: m.fixedSources,
      fans: m.fans,
      views: this.buildViews(m.sab, nx, ny),
    }
    this.ready = true
  }

  private buildViews(sab: ArrayBufferLike, nx: number, ny: number): SimViews | null {
    if (!(sab instanceof SharedArrayBuffer)) return null
    const ex = this.engine.ex
    const n = nx * ny
    const l = TRAIL_LEN
    return {
      u: new Float32Array(sab, ex.fieldU(), n),
      v: new Float32Array(sab, ex.fieldV(), n),
      t: new Float32Array(sab, ex.fieldT(), n),
      fxU: new Float32Array(sab, ex.fieldFxU(), n),
      fxV: new Float32Array(sab, ex.fieldFxV(), n),
      tracerX: new Float32Array(sab, ex.tXBuf(), TRACER_COUNT),
      tracerY: new Float32Array(sab, ex.tYBuf(), TRACER_COUNT),
      life: new Float32Array(sab, ex.tLifeBuf(), TRACER_COUNT),
      maxLife: new Float32Array(sab, ex.tMaxLifeBuf(), TRACER_COUNT),
      trailX: new Float32Array(sab, ex.tTrailXBuf(), TRACER_COUNT * l),
      trailY: new Float32Array(sab, ex.tTrailYBuf(), TRACER_COUNT * l),
      trailT: new Float32Array(sab, ex.tTrailTBuf(), TRACER_COUNT * l),
      trailN: new Uint8Array(sab, ex.tTrailNBuf(), TRACER_COUNT),
    }
  }

  private onHud(state: HudState) {
    if (state.paused !== this.paused) {
      this.paused = state.paused
      if (this.paused) sfx.fadeOutWind()
      bgm.setPaused(this.paused)
      fb.pause(this.paused)
    }
    this.events.onHud(state)
  }
}
