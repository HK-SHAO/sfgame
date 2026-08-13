// 关卡 JSON 结构校验 = levels/level.schema-1.json 的运行时镜像：schema 表达的静态约束两处同源，
// 由 tests/level-schema.test.ts 守护；world 依赖的动态边界（x≤w 等）与 SDF 语义仅此处可表达。
// 错误逐字段 JSON 路径 + 实值；world 非法时动态边界自动失效（undefined），只查结构不级联误报
import { compileSdf, SdfError } from './sdf.ts'
import { terrainDims, FLUID_MARGIN } from '../sim/terrain.ts'
import { GRID_MIN, GRID_MAX_NX, GRID_MAX_NY, CELL_MIN, CELL_MAX } from './grid-limits.ts'

// 关卡 id = 小写 slug（URL 直传零转义、语义化命名）；URL 内联判别（state.ts）依赖此字符集
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/
export const GOAL_R_MAX = 15
export const LIST_MAX = 8
export const TEMP_LIMIT = 10
export const SWING_MAX = Math.PI
export const SPAWN_MARGIN = 20

interface Ctx {
  id: string
  errs: string[]
}

const isFin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

interface NumOpts {
  min?: number
  max?: number
  minExcl?: number
  int?: boolean
}

// 数值字段：有限性 + 类型 + 可选界（undefined 界 = 不检查）；minExcl 为开区间
function num(ctx: Ctx, path: string, v: unknown, o: NumOpts = {}): v is number {
  if (!isFin(v)) {
    ctx.errs.push(`${ctx.id} ${path} = ${JSON.stringify(v)}，需为${o.int ? '整数' : '数值'}`)
    return false
  }
  if (o.int && !Number.isInteger(v)) {
    ctx.errs.push(`${ctx.id} ${path} = ${v}，需为整数`)
    return false
  }
  if (o.minExcl !== undefined && v <= o.minExcl) ctx.errs.push(`${ctx.id} ${path} = ${v}，需 > ${o.minExcl}`)
  else if (o.min !== undefined && v < o.min) ctx.errs.push(`${ctx.id} ${path} = ${v}，需 ≥ ${o.min}`)
  else if (o.max !== undefined && v > o.max) ctx.errs.push(`${ctx.id} ${path} = ${v}，需 ≤ ${o.max}`)
  return true
}

function str(ctx: Ctx, path: string, v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0) {
    ctx.errs.push(`${ctx.id} ${path} 必须为非空字符串`)
    return false
  }
  return true
}

function oneOf(ctx: Ctx, path: string, v: unknown, values: readonly string[]): v is string {
  if (typeof v !== 'string' || !values.includes(v)) {
    ctx.errs.push(`${ctx.id} ${path} 必须为 ${values.join('|')}`)
    return false
  }
  return true
}

function arr(ctx: Ctx, path: string, v: unknown, min = 0, max = Infinity): unknown[] | null {
  if (!Array.isArray(v)) {
    ctx.errs.push(`${ctx.id} ${path} 必须为数组（长度 ${arrSpan(min, max)}）`)
    return null
  }
  if (v.length < min || v.length > max) {
    ctx.errs.push(`${ctx.id} ${path} 必须为数组（长度 ${arrSpan(min, max)}）`)
    return null
  }
  return v
}

const arrSpan = (min: number, max: number) =>
  max === Infinity ? `≥ ${min}` : min === 0 ? `≤ ${max}` : `${min}..${max}`

const KNOWN_TOP = new Set([
  '$schema', 'id', 'name', 'tagline', 'win', 'world', 'terrain',
  'budget', 'spawn', 'goals', 'ambient', 'fixed', 'fans',
])

function checkMeta(ctx: Ctx, j: Record<string, unknown>) {
  // $schema 仅编辑器提示，不校验值（schema 与运行时解耦，错版不拒绝）
  if (typeof j.id !== 'string' || !ID_PATTERN.test(j.id)) {
    ctx.errs.push(`${ctx.id} id = ${JSON.stringify(j.id)}，必须为小写 slug（字母/数字/连字符，≤32 字符）`)
  }
  str(ctx, 'name', j.name)
  str(ctx, 'tagline', j.tagline)
  const w = j.win
  if (!w || typeof w !== 'object') {
    ctx.errs.push(`${ctx.id} win 必须为对象（含非空 title/text）`)
  } else {
    const win = w as Record<string, unknown>
    str(ctx, 'win.title', win.title)
    str(ctx, 'win.text', win.text)
  }
  // 顶层未知字段拒绝（与 schema 根 additionalProperties:false 对齐）：笔误当场暴露
  for (const k of Object.keys(j)) {
    if (!KNOWN_TOP.has(k)) ctx.errs.push(`${ctx.id} 未知字段 "${k}"`)
  }
}

// 返回 {w, h}；结构非法返回 null（下游动态边界随之失效）
function checkWorld(ctx: Ctx, j: Record<string, unknown>): { w: number; h: number } | null {
  const wo = j.world
  if (!wo || typeof wo !== 'object') {
    ctx.errs.push(`${ctx.id} world 必须为对象（含 w/h/cell 正数）`)
    return null
  }
  const w = wo as Record<string, unknown>
  const wv = w.w
  const hv = w.h
  const cv = w.cell
  num(ctx, 'world.w', wv, { minExcl: 0 })
  num(ctx, 'world.h', hv, { minExcl: 0 })
  num(ctx, 'world.cell', cv, { min: CELL_MIN, max: CELL_MAX })
  if (!isFin(wv) || wv <= 0 || !isFin(hv) || hv <= 0 || !isFin(cv) || cv <= 0) return null
  // 流体网格 = 地图外扩边距（与 terrainDims/内核同公式），上限 = 内核编译期钉死容量
  const dims = terrainDims({ w: wv, h: hv }, cv)
  if (dims.nx < GRID_MIN || dims.nx > GRID_MAX_NX || dims.ny < GRID_MIN || dims.ny > GRID_MAX_NY) {
    ctx.errs.push(
      `${ctx.id} 流体网格 ${dims.nx}×${dims.ny}（含边距 ${FLUID_MARGIN}）超出 ` +
        `${GRID_MIN}..${GRID_MAX_NX} × ${GRID_MIN}..${GRID_MAX_NY} 范围`,
    )
  }
  return { w: wv, h: hv }
}

function checkTerrain(ctx: Ctx, j: Record<string, unknown>, wMax?: number, hMax?: number) {
  const t = j.terrain
  if (!t || typeof t !== 'object') {
    ctx.errs.push(`${ctx.id} terrain 必须为对象（含 sdf 表达式）`)
    return
  }
  const sdf = (t as Record<string, unknown>).sdf
  if (typeof sdf !== 'string' || sdf.trim().length === 0) {
    ctx.errs.push(`${ctx.id} terrain.sdf 必须为非空表达式字符串`)
    return
  }
  let f: ((x: number, y: number) => number) | null = null
  try {
    f = compileSdf(sdf)
  } catch (e) {
    ctx.errs.push(`${ctx.id} terrain.sdf 语法错误：${e instanceof SdfError ? e.message : String(e)}`)
    return
  }
  if (wMax !== undefined && hMax !== undefined) sampleTerrain(ctx, f, wMax, hMax)
}

// 语义校验：编译通过的 SDF 在世界网格采样，固/气必须共存（否则永不着地或无处可飞）
function sampleTerrain(ctx: Ctx, f: (x: number, y: number) => number, w: number, h: number) {
  let solid = 0
  let air = 0
  try {
    for (let y = 0.5; y < h; y += 1) {
      for (let x = 0.5; x < w; x += 1) {
        const d = f(x, y)
        if (!Number.isFinite(d)) throw new Error(`(${x}, ${y}) 处非有限值`)
        if (d <= 0) solid++
        else air++
      }
    }
  } catch (e) {
    ctx.errs.push(`${ctx.id} terrain.sdf 求值错误：${e instanceof Error ? e.message : String(e)}`)
    return
  }
  if (solid === 0) ctx.errs.push(`${ctx.id} terrain.sdf 世界内无实体（飞机永不着地）`)
  if (air === 0) ctx.errs.push(`${ctx.id} terrain.sdf 世界内全为实体（无处可飞）`)
}

function checkBudget(ctx: Ctx, j: Record<string, unknown>) {
  const b = j.budget
  if (!b || typeof b !== 'object') {
    ctx.errs.push(`${ctx.id} budget 必须为对象（含非负整数 hot/cold）`)
    return
  }
  const bo = b as Record<string, unknown>
  num(ctx, 'budget.hot', bo.hot, { min: 0, int: true })
  num(ctx, 'budget.cold', bo.cold, { min: 0, int: true })
}

function checkSpawn(ctx: Ctx, j: Record<string, unknown>, wMax?: number, hMax?: number) {
  const s = j.spawn
  if (!s || typeof s !== 'object') {
    ctx.errs.push(`${ctx.id} spawn 必须为对象（含 x）`)
    return
  }
  const so = s as Record<string, unknown>
  num(ctx, 'spawn.x', so.x, { min: -SPAWN_MARGIN, max: wMax === undefined ? undefined : wMax + SPAWN_MARGIN })
  if (so.y !== undefined) num(ctx, 'spawn.y', so.y, { min: -SPAWN_MARGIN, max: hMax === undefined ? undefined : hMax + SPAWN_MARGIN })
  if (so.vx !== undefined) num(ctx, 'spawn.vx', so.vx)
  if (so.vy !== undefined) num(ctx, 'spawn.vy', so.vy)
}

function checkGoals(ctx: Ctx, j: Record<string, unknown>, wMax?: number, hMax?: number) {
  const list = arr(ctx, 'goals', j.goals, 1)
  if (!list) return
  for (let i = 0; i < list.length; i++) {
    const go = list[i]
    if (!go || typeof go !== 'object') {
      ctx.errs.push(`${ctx.id} goals[${i}] 必须为对象（含 x/r）`)
      continue
    }
    const g = go as Record<string, unknown>
    num(ctx, `goals[${i}].x`, g.x, { min: 0, max: wMax })
    if (g.y !== undefined) num(ctx, `goals[${i}].y`, g.y, { minExcl: 0, max: hMax })
    num(ctx, `goals[${i}].r`, g.r, { minExcl: 0, max: GOAL_R_MAX })
  }
}

function checkAmbient(ctx: Ctx, j: Record<string, unknown>) {
  const a = j.ambient
  if (a === undefined) return
  if (!a || typeof a !== 'object') {
    ctx.errs.push(`${ctx.id} ambient 必须为对象（含 x/y）`)
    return
  }
  const ao = a as Record<string, unknown>
  num(ctx, 'ambient.x', ao.x)
  num(ctx, 'ambient.y', ao.y)
  if (ao.temp !== undefined) num(ctx, 'ambient.temp', ao.temp, { min: -TEMP_LIMIT, max: TEMP_LIMIT })
  const t = ao.tide
  if (t === undefined) return
  if (!t || typeof t !== 'object') {
    ctx.errs.push(`${ctx.id} ambient.tide 必须为对象`)
    return
  }
  const to = t as Record<string, unknown>
  num(ctx, 'ambient.tide.period', to.period, { minExcl: 0 })
  if (to.phase !== undefined) num(ctx, 'ambient.tide.phase', to.phase)
  if (to.ampX !== undefined) num(ctx, 'ambient.tide.ampX', to.ampX)
  if (to.ampY !== undefined) num(ctx, 'ambient.tide.ampY', to.ampY)
}

function checkFixed(ctx: Ctx, j: Record<string, unknown>, wMax?: number, hMax?: number) {
  if (j.fixed === undefined) return
  const list = arr(ctx, 'fixed', j.fixed, 0, LIST_MAX)
  if (!list) return
  for (let i = 0; i < list.length; i++) {
    const fo = list[i]
    if (!fo || typeof fo !== 'object') {
      ctx.errs.push(`${ctx.id} fixed[${i}] 必须为对象（含 x/y/kind）`)
      continue
    }
    const f = fo as Record<string, unknown>
    num(ctx, `fixed[${i}].x`, f.x, { min: 0, max: wMax })
    num(ctx, `fixed[${i}].y`, f.y, { minExcl: 0, max: hMax })
    oneOf(ctx, `fixed[${i}].kind`, f.kind, ['hot', 'cold'])
    if (f.power !== undefined) num(ctx, `fixed[${i}].power`, f.power, { minExcl: 0 })
  }
}

function checkFans(ctx: Ctx, j: Record<string, unknown>, wMax?: number, hMax?: number) {
  if (j.fans === undefined) return
  const list = arr(ctx, 'fans', j.fans, 0, LIST_MAX)
  if (!list) return
  for (let i = 0; i < list.length; i++) {
    const fo = list[i]
    if (!fo || typeof fo !== 'object') {
      ctx.errs.push(`${ctx.id} fans[${i}] 必须为对象（含 x/y/dir/power）`)
      continue
    }
    const f = fo as Record<string, unknown>
    num(ctx, `fans[${i}].x`, f.x, { min: 0, max: wMax })
    num(ctx, `fans[${i}].y`, f.y, { minExcl: 0, max: hMax })
    num(ctx, `fans[${i}].dir`, f.dir)
    num(ctx, `fans[${i}].power`, f.power, { minExcl: 0 })
    if (f.swing !== undefined) num(ctx, `fans[${i}].swing`, f.swing, { min: 0, max: SWING_MAX })
    if (f.period !== undefined) num(ctx, `fans[${i}].period`, f.period, { minExcl: 0 })
  }
}

// 返回错误清单（空 = 合法），只列事实不猜意图、不抛错
export function validateLevelJson(raw: unknown): string[] {
  const errs: string[] = []
  if (!raw || typeof raw !== 'object') return ['关卡顶层必须为 JSON 对象']
  const j = raw as Record<string, unknown>
  const ctx: Ctx = { id: `(id=${JSON.stringify(j.id)})`, errs }
  checkMeta(ctx, j)
  const world = checkWorld(ctx, j)
  checkTerrain(ctx, j, world?.w, world?.h)
  checkBudget(ctx, j)
  checkSpawn(ctx, j, world?.w, world?.h)
  checkGoals(ctx, j, world?.w, world?.h)
  checkAmbient(ctx, j)
  checkFixed(ctx, j, world?.w, world?.h)
  checkFans(ctx, j, world?.w, world?.h)
  return errs
}
