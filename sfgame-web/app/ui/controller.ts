import { GameLoop } from '../core/loop.ts'
import { sfx } from '../core/sfx.ts'
import { bgm } from '../core/bgm.ts'
import { fb } from '../core/feedback.ts'
import { governor } from '../core/governor.ts'
import { buildWindProbes, isLanding, sampleWind } from '../core/wind.ts'
import { Tracers, TRAIL_LEN } from '../sim/particles.ts'
import { Clouds } from '../sim/clouds.ts'
import { PLANE_TRAIL_FADE, Trail } from '../sim/trail.ts'
import { type PressVisual, type SourceKind } from '../sim/types.ts'
import { LevelSimulation } from '../game/simulation.ts'
import { FLUID_MARGIN } from '../sim/terrain.ts'
import { levelSeed } from '../game/levels.ts'
import type { HudState, LevelDef, SourcePlacement } from '../game/types.ts'
import { GestureInput } from './input.ts'
import { Renderer } from '../render/render.ts'
import { createEngine, type EngineHandle } from '../wasm/engine.ts'
import { totalPenaltySeconds } from '../game/timer.ts'
import type { PerfRecorder } from '../dev/devtools.ts'

// 拖尾按时间淡出（6s，见 trail.ts）：容量须容下淡出窗内最高可持续航速的采样点，
// 否则满环覆写还在淡出期内的旧点，高速段拖尾尾端提前消失（偏离"随时间淡出"契约）
const PLANE_TRAIL_MAX_SPEED = 30
const PLANE_TRAIL_SAMPLE = 0.3
const PLANE_TRAIL_MAX_POINTS = Math.ceil((PLANE_TRAIL_MAX_SPEED * PLANE_TRAIL_FADE) / PLANE_TRAIL_SAMPLE)
const LAND_SOUND_MIN_INTERVAL = 150
// 粒子数全平台恒定（视觉一致）；性能兜底只降 dpr 分辨率档
const TRACER_COUNT = 400
export interface ControllerEvents {
  onHud(state: HudState): void
  // 放置被拒：client 坐标用于全屏统一波纹反馈（含 letterbox 带内的无效点击）
  onDeny(kind: SourceKind, clientX: number, clientY: number): void
  onSources(sources: SourcePlacement[]): void
  // 每帧状态条数据（sim 时间与罚时）：UI 侧短路消费，零开销
  onStatus(time: number, extra: number): void
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
  private tickMs = 0
  private lastLand = -Infinity
  private rate = 1
  private fitW = 0
  private fitH = 0
  private world: { w: number; h: number }
  private devTools: PerfRecorder | null = null

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
    // 物理与渲染共享同一 wasm 实例：渲染零拷贝读流体内存（每关一次，keyed 重建时整体释放）
    this.engine = createEngine()
    this.devTools = devTools ?? null
    // dev 模式道具不限量：devTools 非空即 dev（app.ts 按 ?dev=1 才构造面板）
    this.sim = new LevelSimulation(level, this.engine, { unlimited: this.devTools !== null })
    // 示踪粒子与云同采烘焙地形场：可随流体飞出地图，采样 clamp 即延展（内核驻 wasm，同引擎实例）。
    // 种子由关卡 slug 派生（与云同策略异盐）：同关粒子场逐位可复现，刷新/重进不变
    this.tracers = new Tracers(
      this.engine, TRACER_COUNT, this.world, this.sim.terrain, TRAIL_LEN, FLUID_MARGIN,
      levelSeed(level.id, 0x85ebca6b),
    )
    this.clouds = new Clouds(levelSeed(level.id), this.world, this.sim.terrain)
    this.planeTrail = new Trail(PLANE_TRAIL_MAX_POINTS, PLANE_TRAIL_SAMPLE, PLANE_TRAIL_FADE)
    const { w, h } = level.world
    this.windProbes = buildWindProbes(w, h)
    this.renderer = new Renderer(canvas, this.engine)
    this.loop = new GameLoop({ tick: this.tick, render: this.render })
    this.input = new GestureInput(canvas, {
      toWorld: (cx, cy) => this.renderer.toWorld(cx, cy),
      hitSource: (w) => this.sim.hitSource(w.x, w.y),
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
        if (this.sim.removeSource(s.id)) {
          fb.remove()
          this.pushHud()
          this.emitSources()
        }
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
  }

  start() {
    // ResizeObserver 覆盖窗口缩放与布局变化（宿主尺寸必然随之改变），无需再监听 window resize
    if ('ResizeObserver' in window) {
      this.ro = new ResizeObserver(() => this.fit())
      this.ro.observe(this.host)
    }
    this.fit()
    this.loop.start()
    this.pushHud()
  }

  // WebGL 上下文创建失败（持久条件）：宿主据此走不支持页，不盲玩
  get renderable(): boolean {
    return this.renderer.available
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
    sfx.fadeOutWind()
    // 离关解除乐暂停：暂停状态下回主页不能把 BGM 永远留在停态
    bgm.setPaused(false)
    // GPU 资源显式释放（GL 对象/监听/context 全清）；engine 等 JS 大对象由 sf-game 断链后 GC 可达性回收
    this.renderer.dispose()
  }

  restart() {
    this.sim.restart()
    // restart 已清 paused，乐同步恢复
    bgm.setPaused(false)
    this.planeTrail.clear()
    this.press = null
    this.lastPhase = 'playing'
    this.pushHud()
  }

  togglePause() {
    this.sim.setPaused(!this.sim.paused)
    if (this.sim.paused) sfx.fadeOutWind()
    bgm.setPaused(this.sim.paused)
    fb.pause(this.sim.paused)
    this.pushHud()
  }

  private pushHud() {
    this.events.onHud(this.sim.hudState())
  }

  private pixelRatio(): number {
    return governor.pixelRatio(window.devicePixelRatio || 1)
  }

  private fit = (force = false) => {
    const rect = this.host.getBoundingClientRect()
    const w = Math.round(rect.width)
    const h = Math.round(rect.height)
    // 任一边为 0（布局瞬态）跳过：会算出 NaN/Inf 视口坐标并在 drawTerrain 抛 RangeError
    if (w === 0 || h === 0) return
    // 尺寸未变跳过：防 ResizeObserver 抖动导致画布每帧重建（iOS 已知坑）；
    // force（dpr 降级）绕过——降级不改变宿主尺寸，守卫会让 resize 永不执行
    if (!force && w === this.fitW && h === this.fitH) return
    this.fitW = w
    this.fitH = h
    // 画布铺满宿主，世界 contain 后界外由渲染器以天空外推填充（取景宽容：宽屏/竖屏均满屏）
    this.renderer.resize(w, h, this.pixelRatio())
    // canvas 尺寸变更会重置 WebGL 缓冲（黑屏）：补画一帧防首帧黑闪
    this.render()
  }

  // 放置被拒统一出口：反馈音 + 全屏波纹 + hud chip 抖动（预算空/位置非法/世界外点击同一路径）
  private deny(kind: SourceKind, clientX: number, clientY: number) {
    fb.deny()
    this.events.onDeny(kind, clientX, clientY)
  }

  private tryPlace(x: number, y: number, kind: SourceKind, clientX: number, clientY: number) {
    this.press = null
    const source = this.sim.placeSource(x, y, kind)
    if (source) {
      if (kind === 'hot') fb.placeHot()
      else fb.placeCold()
      this.pushHud()
      this.emitSources()
    } else {
      this.deny(kind, clientX, clientY)
    }
  }

  // silent = 挂载初始应用，不回写 URL（避免多余历史条目）
  applySources(list: SourcePlacement[], silent = false) {
    // 胜利结算让位：清 visited 让下一帧按"抵达即通关"重新判定（飞机仍在圆内则立即复胜，与注释契约一致）；
    // 结算中暂停+撤销会留下"覆盖层消失而物理冻结"的僵尸态，暂停一并解除
    if (this.sim.phase === 'won') {
      this.sim.phase = 'playing'
      this.sim.visited.fill(false)
      this.sim.visitedCount = 0
      this.sim.setPaused(false)
      bgm.setPaused(false)
    }
    this.sim.applySources(list)
    this.pushHud()
    if (!silent) this.emitSources()
  }

  private emitSources() {
    // 精度对齐交给 URL codec 编码时的 toFixed(1)（state.ts num），此处透传原始坐标
    this.events.onSources(this.sim.sources.map((s) => ({ x: s.x, y: s.y, kind: s.kind })))
  }

  private tick = (dt: number) => {
    const t0 = performance.now()
    const frozen = this.sim.paused || this.sim.phase === 'won'
    const visitedBefore = this.sim.visitedCount

    if (!frozen) {
      const p = this.sim.plane
      // SDF 值即距地表距离：直接作高度语义（坡面/崖壁同样成立）
      const altBefore = this.sim.terrain.sample(p.x, p.y)
      const vyBefore = p.vy

      this.sim.step(dt)
      this.tracers.step(dt, this.sim.sources)
      this.clouds.step(dt, this.sim.fluid)
      this.planeTrail.push(p.x, p.y, this.sim.time)

      const wind = sampleWind(this.sim.fluid, this.windProbes, p, this.tmpAir)
      sfx.updateWind(wind.field, wind.rel, dt)
      sfx.setPlanePan(p.x, this.world.w)
      const altAfter = this.sim.terrain.sample(p.x, p.y)
      if (isLanding(altBefore, altAfter, vyBefore)) {
        const now = performance.now()
        if (now - this.lastLand > LAND_SOUND_MIN_INTERVAL) {
          this.lastLand = now
          fb.land(Math.abs(vyBefore))
        }
      }
    }

    if (this.sim.visitedCount > visitedBefore) {
      if (this.sim.phase === 'won') fb.win()
      else fb.reward()
    }

    if (this.sim.phase !== this.lastPhase) {
      this.lastPhase = this.sim.phase
      if (this.sim.phase === 'won') {
        sfx.fadeOutWind()
      }
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
    // 每帧直推：文本不变时组件内短路，零开销；罚时含贴地累计（贴地时 extra 随物理时间增长）
    this.events.onStatus(this.sim.time, totalPenaltySeconds(this.sim.sources.length, this.sim.groundedTime))
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
    // 降级执行留在 controller（fit 涉及渲染对象）；force 绕尺寸守卫：tier 变化不改变宿主尺寸
    if (governor.record(cost, this.rate)) this.fit(true)
  }
}
