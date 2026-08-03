import { GameLoop } from '../core/loop'
import { sfx } from '../core/sfx'
import { Tracers } from '../sim/particles'
import { Trail } from '../sim/trail'
import type { SourceKind } from '../sim/types'
import { LevelSimulation } from '../game/simulation'
import type { HudState, LevelDef, PressVisual, SourcePlacement } from '../game/types'
import { GestureInput } from './input'
import { Renderer } from './render'

/** 示踪粒子分档（由高到低）：帧率压力下逐级降级，保住 60fps。
 * 桌面初始 400 只（富表现优先），触屏降一档起步。 */
const TRACER_TIERS = [400, 320, 240, 180, 128, 96]
/** 轨迹点上限：移动端缩短（描边负载 ∝ 粒子数 × 轨迹长度，iOS CPU 栅格化最敏感）。 */
const TRAIL_LEN_MOBILE = 12
const TRAIL_LEN_DESKTOP = 24
/** 触屏 dpr 档位（逐级下调，栅格像素成本非线性下降）；桌面档位更宽。 */
const DPR_TIERS_COARSE = [1.5, 1.25, 1.0]
const DPR_TIERS_FINE = [2, 1.5]
/** 持续该时长（帧）帧开销超限才降级，避免偶发卡顿误触发。 */
const SLOW_FRAMES_TO_DEGRADE = 150
/** 帧开销 EMA 超该毫秒数视为需要降级（60fps 预算 16.7ms，留余量）。 */
const FRAME_BUDGET_MS = 13
export interface ControllerEvents {
  onHud(state: HudState): void
  /** 放置被拒绝（预算耗尽或位置无效），供 HUD 抖动提示 */
  onDeny(kind: SourceKind): void
  /** 源集合变化（放置/移除/整体应用后），供 URL 状态双向同步 */
  onSources?(sources: SourcePlacement[]): void
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
  /** 示踪粒子档位（TRACER_TIERS 下标），随帧开销自适应降级 */
  private tracerLevel: number
  private trailLen: number
  private dprTier = 0
  private dprTiers: number[]
  private frameEma = 0
  private slowFrames = 0
  private tickMs = 0
  private fitW = 0
  private fitH = 0
  private world: { w: number; h: number }
  private ground: (x: number) => number

  constructor(
    canvas: HTMLCanvasElement,
    level: LevelDef,
    events: ControllerEvents,
    host?: HTMLElement,
  ) {
    this.canvas = canvas
    this.events = events
    this.host = host ?? canvas.parentElement ?? canvas
    this.world = level.world
    this.ground = level.ground
    this.sim = new LevelSimulation(level)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const coarse = window.matchMedia('(pointer: coarse)').matches
    this.dprTiers = coarse ? DPR_TIERS_COARSE : DPR_TIERS_FINE
    // 移动端（触屏）Canvas 2D 在 iOS 上为 CPU 栅格化，初始档位放低省绘制预算
    this.tracerLevel = reduced
      ? TRACER_TIERS.length - 1
      : coarse
        ? 4
        : 0
    this.trailLen = coarse || reduced ? TRAIL_LEN_MOBILE : TRAIL_LEN_DESKTOP
    this.tracers = new Tracers(
      TRACER_TIERS[this.tracerLevel],
      this.world,
      this.ground,
      this.trailLen,
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
    // 重置后源集合为空，需同步 URL（否则刷新页面会带回旧放置）
    this.emitSources()
  }

  private pushHud() {
    this.events.onHud(this.sim.hudState())
  }

  /** 像素比：随档位下调（持续重载时最后手段），Canvas 2D 栅格分辨率直接决定绘制成本。 */
  private pixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, this.dprTiers[this.dprTier])
  }

  private fit = () => {
    const rect = this.host.getBoundingClientRect()
    const w = Math.round(rect.width)
    const h = Math.round(rect.height)
    if (w === 0 && h === 0) return
    // 尺寸未变则跳过：防止 ResizeObserver 抖动/循环导致画布每帧重建（iOS 已知坑）
    if (w === this.fitW && h === this.fitH) return
    this.fitW = w
    this.fitH = h
    this.renderer.resize(w, h, this.pixelRatio())
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

  /** 按目标列表应用源放置（URL 状态变化）。差异算法在 LevelSimulation（无头可测）。
   * silent：挂载时的初始应用，不回写 URL（避免把非规范 URL 规范化成一条多余历史）。 */
  applySources(list: SourcePlacement[], silent = false) {
    // 胜利结算让位：让玩家看到新状态（若仍满足胜利条件，下一帧会自然重新判定）
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

    this.tickMs += performance.now() - t0
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
    const t0 = performance.now()
    this.renderer.draw({
      sim: this.sim,
      tracers: this.tracers,
      planeTrail: this.planeTrail,
      press: this.press,
      now: performance.now(),
    })
    const cost = performance.now() - t0 + this.tickMs
    this.tickMs = 0
    this.frameEma = this.frameEma === 0 ? cost : this.frameEma * 0.95 + cost * 0.05
    // 持续超预算才降级：先降示踪粒子（观感影响小），粒子到最低档仍不够再降 dpr
    if (this.frameEma > FRAME_BUDGET_MS) {
      if (++this.slowFrames > SLOW_FRAMES_TO_DEGRADE) {
        this.slowFrames = 0
        if (this.tracerLevel < TRACER_TIERS.length - 1) {
          this.tracerLevel++
          this.tracers = new Tracers(
            TRACER_TIERS[this.tracerLevel],
            this.world,
            this.ground,
            this.trailLen,
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
