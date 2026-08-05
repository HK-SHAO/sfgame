import { Fluid, type FluidConfig } from '../sim/fluid'
import { createBody, stepBody, type Body } from '../sim/bodies'
import type { SourceKind } from '../sim/types'
import { penaltySeconds } from './timer'
import type { HudState, LevelDef, Source, SourcePlacement } from './types'

/** 流体物理调参：所有关卡共享同一套"空气性格"。 */
const FLUID_TUNING: Omit<FluidConfig, 'nx' | 'ny' | 'cell'> = {
  buoyancy: 2.0,
  tMax: 9,
  heatRate: 10,
  sourceRadius: 3.4,
  velDamping: 0.997,
  tDamping: 0.99,
  iterations: 12,
  vorticity: 0.5,
}

/** 悬停阈值 = gravity/dragK ≈ 1.0（上升风需超过它才能抬升）。 */
const PLANE_PHYSICS = { radius: 1.0, dragK: 3.0, gravity: 3.0 }

/** 源之间的最小间距，避免叠放。 */
const MIN_SOURCE_GAP = 3.2
const SOURCE_HIT_RADIUS = 3.0
/** 放置下限：地面之上该高度内均可放置；贴地吸附高度 */
const GROUND_PLACE_MARGIN = 0.6
const GROUND_SNAP_LIFT = 0.7
/** 目标区圆心在地面上的抬升高度（虚线圆渲染与检测共用，见 render.ts） */
export const GOAL_LIFT = 2
/** URL 位置匹配容差：对齐 URL 的 1 位小数精度（舍入误差 ≤0.05） */
const URL_PRECISION_TOLERANCE = 0.06

/**
 * 无头关卡模拟（不依赖 DOM，可在 bun 中测试）。
 * 胜负语义：飞机进入抵达圆（圆心 = 目标点上方 GOAL_LIFT，半径 = 关卡 g.r，
 * 与渲染的虚线圆完全一致）即算"抵达过"，贴地滑入同样计数；顺序不限。
 * 挂机不可通关由关卡设计保证（见 tests/solutions.test.ts 的零操作回归）。
 * 过关瞬间与显式暂停都会冻结物理与时钟——结算弹窗弹出时背景不再运行。
 */
export class LevelSimulation {
  readonly level: LevelDef
  readonly fluid: Fluid
  readonly plane: Body
  sources: Source[] = []
  phase: 'playing' | 'won' = 'playing'
  time = 0
  /** 各站点是否已飞行抵达过（全部 true 即过关）。 */
  visited: boolean[]
  /** 已抵达站点数（渲染/音效用）。 */
  visitedCount = 0
  /** 显式暂停 step（dev 空格切换；过关自动等效暂停）。 */
  paused = false

  private nextId = 1
  private usedHot = 0
  private usedCold = 0
  private placed = 0
  private spawnY: number
  private spawnVx: number
  private spawnVy: number

  constructor(level: LevelDef) {
    this.level = level
    const { w, h, cell } = level.world
    this.fluid = new Fluid({
      nx: Math.round(w / cell),
      ny: Math.round(h / cell),
      cell,
      ...FLUID_TUNING,
    })
    this.fluid.setGroundMask(level.ground)
    this.applyAmbient(0)
    this.visited = level.goals.map(() => false)
    this.spawnY = level.spawn.y ?? level.ground(level.spawn.x) - 1.4
    this.spawnVx = level.spawn.vx ?? 0
    this.spawnVy = level.spawn.vy ?? 0
    this.plane = createBody(level.spawn.x, this.spawnY, PLANE_PHYSICS)
    this.plane.vx = this.spawnVx
    this.plane.vy = this.spawnVy
  }

  get hotLeft() {
    return this.unlimited ? Infinity : this.level.budget.hot - this.usedHot
  }

  get coldLeft() {
    return this.unlimited ? Infinity : this.level.budget.cold - this.usedCold
  }

  /** 道具不限量（预算校验跳过；HUD 显示 ∞）。仅 dev 模式（?dev=1）由 controller 注入，产品路径恒 false */
  unlimited = false

  hudState(): HudState {
    return {
      phase: this.phase,
      hotLeft: this.hotLeft,
      coldLeft: this.coldLeft,
      placed: this.placed,
      // time 为通关时刻（won 即冻结），extra 为按场上源数计的罚时
      time: this.time,
      extra: penaltySeconds(this.sources.length),
      sources: this.sources.length,
    }
  }

  /** 完整重置：清场、清空源与预算占用。 */
  reset() {
    this.fluid.clear()
    this.sources = []
    this.usedHot = 0
    this.usedCold = 0
    this.placed = 0
    this.phase = 'playing'
    this.time = 0
    this.visited.fill(false)
    this.visitedCount = 0
    this.paused = false
    this.plane.x = this.level.spawn.x
    this.plane.y = this.spawnY
    this.plane.vx = this.spawnVx
    this.plane.vy = this.spawnVy
    this.plane.angle = 0
  }

  /** 只清场与复位飞机，保留玩家已放置的源与预算（UI「再玩一次」语义）。 */
  restart() {
    this.fluid.clear()
    this.phase = 'playing'
    this.time = 0
    this.visited.fill(false)
    this.visitedCount = 0
    this.paused = false
    // 源在新的一局重放生长动画：born 归零（否则 time < born，渲染 pop 为负 → 源隐形）
    for (const s of this.sources) s.born = 0
    this.plane.x = this.level.spawn.x
    this.plane.y = this.spawnY
    this.plane.vx = this.spawnVx
    this.plane.vy = this.spawnVy
    this.plane.angle = 0
  }

  /** 显式暂停/恢复（dev 空格）；过关冻结独立于此标志。 */
  setPaused(paused: boolean) {
    this.paused = paused
  }

  canPlaceAt(x: number, y: number): boolean {
    const { w } = this.level.world
    if (x < 2 || x > w - 2 || y < 3) return false
    if (y > this.level.ground(x) - GROUND_PLACE_MARGIN) return false
    for (const s of this.sources) {
      if (Math.hypot(s.x - x, s.y - y) < MIN_SOURCE_GAP) return false
    }
    return true
  }

  hitSource(x: number, y: number): Source | null {
    let best: Source | null = null
    let bestDist = SOURCE_HIT_RADIUS
    for (const s of this.sources) {
      const d = Math.hypot(s.x - x, s.y - y)
      if (d < bestDist) {
        bestDist = d
        best = s
      }
    }
    return best
  }

  /** force 仅绕过"must be playing"（URL 状态恢复用，含获胜后重做）；预算与位置校验仍生效。 */
  placeSource(x: number, y: number, kind: SourceKind, force = false): Source | null {
    if (!force && this.phase !== 'playing') return null
    if (!this.unlimited && (kind === 'hot' ? this.hotLeft <= 0 : this.coldLeft <= 0)) return null
    // 点在地面/物体上时，吸附到贴地高度——"在脚下放源"是核心交互，不应拒绝
    const cy = Math.min(y, this.level.ground(x) - GROUND_SNAP_LIFT)
    if (!this.canPlaceAt(x, cy)) return null
    const source: Source = { id: this.nextId++, kind, x, y: cy, born: this.time }
    this.sources.push(source)
    if (kind === 'hot') this.usedHot++
    else this.usedCold++
    this.placed++
    return source
  }

  removeSource(id: number): boolean {
    const i = this.sources.findIndex((s) => s.id === id)
    if (i < 0) return false
    const s = this.sources[i]
    this.sources.splice(i, 1)
    if (s.kind === 'hot') this.usedHot--
    else this.usedCold--
    return true
  }

  /** 源集合收敛到目标列表（URL 状态应用，最小差异）：存活源保留原 id/born（不重播生长动画）；
   * 移除必须与目标列表比对（比对场上会永不删除）；幂等，可安全重复调用。 */
  applySources(target: SourcePlacement[]): void {
    const match = (a: Source, b: SourcePlacement) =>
      a.kind === b.kind &&
      Math.abs(a.x - b.x) < URL_PRECISION_TOLERANCE &&
      Math.abs(a.y - b.y) < URL_PRECISION_TOLERANCE
    for (const s of [...this.sources]) {
      if (!target.some((t) => match(s, t))) this.removeSource(s.id)
    }
    for (const t of target) {
      if (!this.sources.some((s) => match(s, t))) this.placeSource(t.x, t.y, t.kind, true)
    }
  }

  step(dt: number) {
    if (this.paused || this.phase === 'won') return
    // time 先于 checkGoals 递增：won 冻结时展示的即为通关时刻
    this.time += dt
    this.applyAmbient(this.time)
    const rate = FLUID_TUNING.heatRate * dt
    for (const s of this.sources) {
      this.fluid.addHeat(s.x, s.y, s.kind === 'hot' ? rate : -rate)
    }
    this.fluid.step(dt)
    stepBody(this.plane, this.fluid, dt, this.level.ground, this.level.world)
    this.checkGoals()
  }

  /** 常风 + 潮汐正弦分量的合成（确定性，随模拟时钟推进）。 */
  private applyAmbient(t: number) {
    const a = this.level.ambient
    let ax = a?.x ?? 0
    let ay = a?.y ?? 0
    const tide = a?.tide
    if (tide) {
      const ph = (Math.PI * 2 * t) / tide.period + (tide.phase ?? 0)
      ax += (tide.ampX ?? 0) * Math.sin(ph)
      ay += (tide.ampY ?? 0) * Math.sin(ph)
    }
    this.fluid.setAmbient(ax, ay)
  }

  private checkGoals() {
    let changed = false
    for (let i = 0; i < this.level.goals.length; i++) {
      if (this.visited[i]) continue
      const g = this.level.goals[i]
      const gy = this.level.ground(g.x) - GOAL_LIFT
      // 圆心/半径与渲染虚线圆一致：滑行与飞行同等计数（#11）
      if (Math.hypot(this.plane.x - g.x, this.plane.y - gy) >= g.r) continue
      this.visited[i] = true
      this.visitedCount++
      changed = true
    }
    if (changed && this.visitedCount >= this.level.goals.length) this.phase = 'won'
  }
}
