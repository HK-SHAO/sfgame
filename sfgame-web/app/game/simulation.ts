import type { FluidConfig, FluidLike } from '../sim/fluid'
import { createFluid } from '../sim/fluid'
import type { EngineHandle } from '../wasm/engine'
import { createBody, stepBody, type Body } from '../sim/bodies'
import type { SourceKind } from '../sim/types'
import { penaltySeconds } from './timer'
import type { FanDef, HudState, LevelDef, Source, SourcePlacement } from './types'

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

// 悬停阈值 = gravity/dragK ≈ 1.0（上升风需超过它才能抬升）
const PLANE_PHYSICS = { radius: 1.0, dragK: 3.0, gravity: 3.0 }

// 风扇注入半径（世界单位）：与源半径同量级，圆域内速度以 falloff 注入
const FAN_RADIUS = 3.0

const MIN_SOURCE_GAP = 3.2
const SOURCE_HIT_RADIUS = 3.0
const GROUND_PLACE_MARGIN = 0.6
const GROUND_SNAP_LIFT = 0.7
// 目标区圆心在地面上的抬升高度（虚线圆渲染与检测共用，见 render.ts）
export const GOAL_LIFT = 2
// URL 位置匹配容差：对齐 URL 的 1 位小数精度（舍入误差 ≤0.05）
const URL_PRECISION_TOLERANCE = 0.06

// 胜负语义：进入抵达圆（与渲染虚线圆一致）即算抵达，贴地滑入同样计数、顺序不限；过关瞬间与显式暂停都冻结物理与时钟
export class LevelSimulation {
  readonly level: LevelDef
  readonly fluid: FluidLike
  readonly plane: Body
  // 关卡自带的固定源：玩家不可移除、不计预算（独立数组，hitSource 天然不命中）
  readonly fixedSources: Source[]
  readonly fans: FanDef[]
  sources: Source[] = []
  phase: 'playing' | 'won' = 'playing'
  time = 0
  visited: boolean[]
  visitedCount = 0
  paused = false

  private nextId = 1
  private usedHot = 0
  private usedCold = 0
  private placed = 0
  private spawnY: number
  private spawnVx: number
  private spawnVy: number

  // engine 可选：浏览器由 controller 注入（流体与渲染共享同一 wasm 实例/内存）；无头脚本/测试不传则自建独立实例
  constructor(level: LevelDef, engine?: EngineHandle) {
    this.level = level
    const { w, h, cell } = level.world
    this.fluid = createFluid(
      {
        nx: Math.round(w / cell),
        ny: Math.round(h / cell),
        cell,
        ...FLUID_TUNING,
      },
      engine,
    )
    this.fluid.setGroundMask(level.ground)
    this.applyAmbient(0)
    this.visited = level.goals.map(() => false)
    // 负 id 区段：与玩家源 id 空间隔离；born=-1 免生长动画（渲染 pop 恒为 1）
    this.fixedSources = level.fixed.map((f, i) => ({
      id: -i - 1,
      kind: f.kind,
      x: f.x,
      y: f.y,
      born: -1,
      power: f.power,
    }))
    this.fans = level.fans
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

  // 道具不限量：仅 dev 模式（?dev=1）由 controller 注入，产品路径恒 false
  unlimited = false

  hudState(): HudState {
    return {
      phase: this.phase,
      hotLeft: this.hotLeft,
      coldLeft: this.coldLeft,
      placed: this.placed,
      time: this.time,
      extra: penaltySeconds(this.sources.length),
      sources: this.sources.length,
      paused: this.paused,
    }
  }

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

  setPaused(paused: boolean) {
    this.paused = paused
  }

  canPlaceAt(x: number, y: number): boolean {
    const { w } = this.level.world
    // 边界对齐 toWorld ±0.5 与粒子重生边界：整个可视世界皆可放置，无不可放置死角
    if (x < 0.5 || x > w - 0.5 || y < 3) return false
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

  // force 仅绕过"must be playing"（URL 状态恢复用，含获胜后重做）；预算与位置校验仍生效
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

  // URL 状态最小差异收敛：存活源保留原 id/born（不重播生长动画）；移除必须与目标列表比对（比对场上会永不删除）；幂等
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
    for (const s of this.fixedSources) {
      this.fluid.addHeat(s.x, s.y, (s.kind === 'hot' ? rate : -rate) * (s.power ?? 1))
    }
    for (const f of this.fans) {
      const dir = fanDirection(f, this.time)
      this.fluid.addForce(f.x, f.y, Math.cos(dir), Math.sin(dir), f.power * dt, FAN_RADIUS)
    }
    this.fluid.step(dt)
    stepBody(this.plane, this.fluid, dt, this.level.ground, this.level.world)
    this.checkGoals()
  }

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

// 摇头风扇当前朝向：dir 为基线，swing 摆幅按 period 正弦摆动（纯函数，模拟与渲染共用）
export function fanDirection(f: FanDef, t: number): number {
  if (f.swing === undefined || f.period === undefined || f.swing <= 0) return f.dir
  return f.dir + f.swing * Math.sin((Math.PI * 2 * t) / f.period)
}
