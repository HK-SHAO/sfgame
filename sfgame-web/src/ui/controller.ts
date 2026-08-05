import { GameLoop } from '../core/loop'
import { sfx } from '../core/sfx'
import { Tracers, TRAIL_LEN } from '../sim/particles'
import { Clouds } from '../sim/clouds'
import { Trail } from '../sim/trail'
import type { SourceKind } from '../sim/types'
import { LevelSimulation } from '../game/simulation'
import type { HudState, LevelDef, PressVisual, SourcePlacement } from '../game/types'
import { GestureInput } from './input'
import { Renderer } from './render'
import { SfStatusBar } from './status-bar'
import { urlState } from '../game/state'
import { penaltySeconds } from '../game/timer'
import { DevTools } from './devtools'

/** 示踪粒子分档（由高到低）：帧率压力下逐级降级，保住 60fps。
 * 渲染已 GPU 化，粒子数主要消耗 CPU 采样预算，档位只按模拟成本取舍。 */
const TRACER_TIERS = [400, 320, 240, 180, 128, 96]
const COARSE_TRACER_TIER = 2
const PLANE_TRAIL_MAX_POINTS = 150
const PLANE_TRAIL_SAMPLE = 0.3
/** 飞机拖尾存留时长（秒）：随时间淡出，停驻时同样老化消失 */
const PLANE_TRAIL_FADE = 6
/** 风场采样探针（世界坐标的固定比例点）：底噪声源的均匀覆盖 */
const WIND_PROBE_FX = [0.22, 0.5, 0.78]
const WIND_PROBE_FY = [0.2, 0.35]
const LAND_ALT_BEFORE = 0.9
const LAND_ALT_AFTER = 0.55
const LAND_IMPACT_MIN = 0.8
/** 落地音最小间隔（ms）：贴地滚动颠簸时防止连发叠加成轰隆 */
const LAND_SOUND_MIN_INTERVAL = 150
/** dpr 档位（GPU 栅格化后仅持续过载时的最后手段，上限放宽到 2）。 */
const DPR_TIERS_COARSE = [2, 1.5, 1.0]
const DPR_TIERS_FINE = [2, 1.5]
/** 持续该时长（帧）帧开销超限才降级，避免偶发卡顿误触发。 */
const SLOW_FRAMES_TO_DEGRADE = 150
/** 帧开销 EMA 超该毫秒数视为需要降级（60fps 预算 16.7ms，留余量）。 */
const FRAME_BUDGET_MS = 13
const FRAME_EMA_SMOOTH = 0.95
export interface ControllerEvents {
  onHud(state: HudState): void
  /** 放置被拒绝（预算耗尽或位置无效），供 HUD 抖动提示 */
  onDeny(kind: SourceKind): void
  /** 源集合变化（放置/移除/整体应用后），供 URL 状态双向同步 */
  onSources?(sources: SourcePlacement[]): void
}

/** 游戏控制器：组装无头模拟、渲染、手势输入与音效。 */
export class GameController {
  private sim: LevelSimulation
  private tracers: Tracers
  /** 云（纯视觉，随天气系统在风场中漂移） */
  private clouds: Clouds
  /** 纸飞机拖尾：按路程淡出，停驻时轨迹保留 */
  private planeTrail: Trail
  private renderer: Renderer
  private loop: GameLoop
  private input: GestureInput
  private events: ControllerEvents
  /** 尺寸适配宿主：画布随其缩放。默认取画布的父元素（light DOM 下可用）。 */
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
  /** dev 模式（?dev=1）工具：perf 叠加层/空格暂停（见 devtools.ts） */
  private devTools: DevTools | null = null
  /** 底部常驻状态卡（操作说明 + 实时用时/罚时，见 status-bar.ts） */
  private statusEl: SfStatusBar | null = null

  constructor(
    canvas: HTMLCanvasElement,
    level: LevelDef,
    events: ControllerEvents,
    host?: HTMLElement,
  ) {
    this.events = events
    this.host = host ?? canvas.parentElement ?? canvas
    this.world = level.world
    this.ground = level.ground
    this.sim = new LevelSimulation(level)
    if (urlState.get('dev')) {
      // dev 模式：道具不限量 + 调试工具
      this.sim.unlimited = true
      this.devTools = new DevTools()
    }
    // 底部状态卡：常驻 UI。挂 document.body（fixed 定位，与 DevTools 叠加层同款；
    // sf-game 无 slot，挂宿主 light DOM 不可见）
    const status = new SfStatusBar()
    status.setLevel(level.id, level.name)
    document.body.appendChild(status)
    this.statusEl = status
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const coarse = window.matchMedia('(pointer: coarse)').matches
    this.dprTiers = coarse ? DPR_TIERS_COARSE : DPR_TIERS_FINE
    // 触屏设备初始粒子档略低（CPU 采样预算），帧率压力下由降级阶梯继续收敛
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
    // 云按 level id 伪随机生成：重开同一关，天上还是那几朵
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
    this.devTools?.attach(this.sim)
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
    this.devTools?.destroy()
    this.devTools = null
    this.statusEl?.remove()
    this.statusEl = null
    // 淡出风声：否则返回标题页后风声残留
    sfx.fadeOutWind()
  }

  restart() {
    this.sim.restart()
    this.planeTrail.clear()
    this.press = null
    this.lastPhase = 'playing'
    this.pushHud()
    // restart 会复位暂停状态，同步 dev 面板指示
    this.devTools?.syncPause()
  }

  private pushHud() {
    this.events.onHud(this.sim.hudState())
  }

  /** dpr 随档位下调（持续过载的最后手段）：帧缓冲尺寸决定 GPU 光栅化负载。 */
  private pixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, this.dprTiers[this.dprTier])
  }

  private fit = () => {
    const rect = this.host.getBoundingClientRect()
    const w = Math.round(rect.width)
    const h = Math.round(rect.height)
    // 任一边为 0（布局瞬态）跳过：0 高会算出 scale=0 的 NaN/Inf 视口坐标，
    // 渲染错乱之外还会在 drawTerrain 分配时抛 RangeError 杀死游戏循环
    if (w === 0 || h === 0) return
    // 尺寸未变则跳过：防止 ResizeObserver 抖动/循环导致画布每帧重建（iOS 已知坑）
    if (w === this.fitW && h === this.fitH) return
    this.fitW = w
    this.fitH = h
    this.renderer.resize(w, h, this.pixelRatio())
    // canvas 尺寸变更会重置 WebGL 绘制缓冲（黑屏）：同步补画一帧，
    // 避免进入关卡/旋转/缩放的首帧出现黑色闪烁
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

  /** 按目标列表应用源放置（URL 状态变化；差异算法在 LevelSimulation，无头可测）。
   * silent = 挂载时的初始应用，不回写 URL（避免把非规范 URL 规范化成多余历史）。 */
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

    // 站点被抵达：奖励提示音；最后一站同时触发过关（用过关琶音收束）
    if (this.sim.visitedCount > visitedBefore) {
      if (this.sim.phase === 'won') sfx.win()
      else sfx.reward()
    }

    if (this.sim.phase !== this.lastPhase) {
      this.lastPhase = this.sim.phase
      // 过关瞬间冻结物理：风也静下来（与"背景不再运行"的体感一致）
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
    // 状态卡每帧直推（文本不变时组件内部短路，零渲染开销）
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
    // 帧预算随速率放大（但以 1× 为下限）：倍速下每帧本就要消化 rate×tick，
    // 慢帧是预期而非故障，且流体成本不可降级，高速率下阶梯只会白降画质；
    // 而 batch/GPU 成本不随速率收缩，降速时预算不得按比例缩到固定成本以下
    if (this.frameEma > FRAME_BUDGET_MS * Math.max(1, this.rate)) {
      // 先降示踪粒子（观感影响小），粒子到底仍不够再降 dpr
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
