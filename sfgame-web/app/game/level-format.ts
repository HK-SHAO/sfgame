import { parse as parseYaml } from 'yaml'
import { compileExpr, ExprError } from './expr'
import type { LevelDef, LevelJson } from './types'

// 关卡协议版本：YAML 顶层必须为 1
const LEVEL_SCHEMA = 1

const isFin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isInt = (v: unknown): v is number => isFin(v) && Number.isInteger(v)
// 可选数值带界助手：undefined = 未声明（放行）；否则须满足界
const optNum = (v: unknown): boolean => v === undefined || isFin(v)
const optPos = (v: unknown): boolean => v === undefined || (isFin(v) && v > 0)
const optIn = (v: unknown, min: number, max: number): boolean =>
  v === undefined || (isFin(v) && v >= min && v <= max)

// 校验上下文：错误前缀 + 世界边界（world 非法时以 0 兜底：只列事实，不得因缺字段抛 TypeError）
interface Ctx {
  id: string
  errs: string[]
  wMax: number
  hMax: number
  budget: { hot: number; cold: number } | undefined
}

const fail = (ctx: Ctx, msg: string) => ctx.errs.push(`${ctx.id} ${msg}`)

function checkGroundExpr(w: { w: number; h: number }, g: { expr: string }, ctx: Ctx) {
  let f: ((x: number) => number) | null = null
  try {
    f = compileExpr(g.expr)
  } catch (e) {
    fail(ctx, `ground.expr 语法错误：${e instanceof ExprError ? e.message : String(e)}`)
  }
  if (!f) return
  let outOfWorld = 0
  try {
    for (let x = 0; x <= w.w + 1e-9; x += 0.5) {
      const y = f(x)
      if (!Number.isFinite(y) || y <= 0.5 || y >= w.h - 0.5) outOfWorld++
    }
  } catch (e) {
    outOfWorld = -1
    fail(ctx, `ground.expr 求值错误：${e instanceof ExprError ? e.message : String(e)}`)
  }
  if (outOfWorld > 0) fail(ctx, `ground.expr 在 ${outOfWorld} 个采样点超出世界高度 (0.5, h-0.5)`)
}

function checkGoals(j: unknown, ctx: Ctx) {
  if (!Array.isArray(j) || j.length === 0) {
    fail(ctx, 'goals 至少 1 个站点')
    return
  }
  for (let i = 0; i < j.length; i++) {
    const go = j[i]
    if (!go || !isFin(go.x) || go.x < 0 || go.x > ctx.wMax || !isFin(go.r) || go.r <= 0 || go.r > 15) {
      fail(ctx, `goals[${i}] 需满足 0≤x≤w、0<r≤15`)
    }
  }
}

function checkFixedList(j: unknown, ctx: Ctx) {
  if (!Array.isArray(j) || j.length > 8) {
    fail(ctx, 'fixed 必须为数组且 ≤8 个')
    return
  }
  for (let i = 0; i < j.length; i++) {
    const f = j[i]
    if (!f || !isFin(f.x) || f.x < 0 || f.x > ctx.wMax || !isFin(f.y) || f.y <= 0 || f.y > ctx.hMax) {
      fail(ctx, `fixed[${i}] 需满足 0≤x≤w、0<y≤h`)
      continue
    }
    if (f.kind !== 'hot' && f.kind !== 'cold') fail(ctx, `fixed[${i}] kind 必须为 hot|cold`)
    if (!optPos(f.power)) fail(ctx, `fixed[${i}] power 必须为正数`)
  }
}

function checkFansList(j: unknown, ctx: Ctx) {
  if (!Array.isArray(j) || j.length > 8) {
    fail(ctx, 'fans 必须为数组且 ≤8 个')
    return
  }
  for (let i = 0; i < j.length; i++) {
    const f = j[i]
    if (
      !f ||
      !isFin(f.x) ||
      f.x < 0 ||
      f.x > ctx.wMax ||
      !isFin(f.y) ||
      f.y <= 0 ||
      f.y > ctx.hMax ||
      !isFin(f.dir) ||
      !isFin(f.power) ||
      f.power <= 0
    ) {
      fail(ctx, `fans[${i}] 需含数值 x/y/dir 与正数 power`)
      continue
    }
    if (!optIn(f.swing, 0, Math.PI)) fail(ctx, `fans[${i}] swing 需在 [0, π]`)
    if (!optPos(f.period)) fail(ctx, `fans[${i}] period 必须为正数`)
  }
}

function checkSolutionsList(j: unknown, ctx: Ctx) {
  if (!Array.isArray(j)) {
    fail(ctx, 'solutions 必须为数组')
    return
  }
  for (let i = 0; i < j.length; i++) {
    const sol = j[i]
    if (
      !sol ||
      typeof sol.name !== 'string' ||
      sol.name.length === 0 ||
      !Array.isArray(sol.sources) ||
      !isFin(sol.winTime) ||
      sol.winTime <= 0
    ) {
      fail(ctx, `solutions[${i}] 需含非空 name、sources 数组与正数 winTime`)
      continue
    }
    let hot = 0
    let cold = 0
    for (const src of sol.sources) {
      if (!src || !isFin(src.x) || !isFin(src.y) || (src.kind !== 'hot' && src.kind !== 'cold')) {
        fail(ctx, `solutions[${i}] 源需为 {x,y,kind:'hot'|'cold'}`)
        continue
      }
      if (src.kind === 'hot') hot++
      else cold++
    }
    if (ctx.budget && (hot > ctx.budget.hot || cold > ctx.budget.cold)) {
      fail(ctx, `solutions[${i}] 源数量超出预算`)
    }
  }
}

// 返回错误清单（空 = 合法），只列事实不猜意图、不抛错
export function validateLevelJson(raw: unknown): string[] {
  const errs: string[] = []
  const j = raw as LevelJson
  if (!j || typeof j !== 'object') return ['不是对象']
  const ctx: Ctx = {
    id: `(id=${(j as { id?: unknown }).id})`,
    errs,
    wMax: 0,
    hMax: 0,
    budget: undefined,
  }

  if (j.schema !== LEVEL_SCHEMA) fail(ctx, `schema 必须为 ${LEVEL_SCHEMA}`)
  if (!isInt(j.id) || j.id < 1) fail(ctx, 'id 必须为正整数')
  for (const k of ['name', 'tagline'] as const) {
    if (typeof j[k] !== 'string' || j[k].length === 0) fail(ctx, `${k} 必须为非空字符串`)
  }
  if (
    !j.win ||
    typeof j.win.title !== 'string' ||
    j.win.title.length === 0 ||
    typeof j.win.text !== 'string' ||
    j.win.text.length === 0
  ) {
    fail(ctx, 'win.title/text 必须为非空字符串')
  }

  const w = j.world
  if (!w || !isFin(w.w) || w.w <= 0 || !isFin(w.h) || w.h <= 0 || !isFin(w.cell) || w.cell <= 0) {
    fail(ctx, 'world.w/h/cell 必须为正数')
  } else {
    ctx.wMax = w.w
    ctx.hMax = w.h
    const nx = Math.round(w.w / w.cell)
    const ny = Math.round(w.h / w.cell)
    if (nx < 16 || nx > 256 || ny < 16 || ny > 256) fail(ctx, `网格 ${nx}×${ny} 超出 16..256 范围`)
  }

  const g = j.ground
  if (!g || typeof g.expr !== 'string' || g.expr.trim().length === 0) {
    fail(ctx, 'ground.expr 必须为非空表达式字符串')
  } else if (w) {
    checkGroundExpr(w, g, ctx)
  }

  const b = j.budget
  if (!b || !isInt(b.hot) || b.hot < 0 || !isInt(b.cold) || b.cold < 0) {
    fail(ctx, 'budget.hot/cold 必须为非负整数')
  } else {
    ctx.budget = b
  }

  const s = j.spawn
  if (!s) {
    fail(ctx, 'spawn 需含 x/y')
  } else {
    if (!isFin(s.x) || s.x < -20 || s.x > ctx.wMax + 20) fail(ctx, 'spawn.x 超出 [-20, w+20]')
    if (s.y !== undefined && (!isFin(s.y) || s.y < -20 || s.y > ctx.hMax + 20)) fail(ctx, 'spawn.y 超出范围')
    if (s.vx !== undefined && !isFin(s.vx)) fail(ctx, 'spawn.vx 必须为数值')
    if (s.vy !== undefined && !isFin(s.vy)) fail(ctx, 'spawn.vy 必须为数值')
  }

  checkGoals(j.goals, ctx)

  const a = j.ambient
  if (a !== undefined) {
    if (!isFin(a.x) || !isFin(a.y)) fail(ctx, 'ambient.x/y 必须为数值')
    if (a.tide !== undefined) {
      if (!optPos(a.tide.period)) fail(ctx, 'ambient.tide.period 必须为正数')
      if (!optNum(a.tide.phase)) fail(ctx, 'ambient.tide.phase 必须为数值')
      if (!optNum(a.tide.ampX)) fail(ctx, 'ambient.tide.ampX 必须为数值')
      if (!optNum(a.tide.ampY)) fail(ctx, 'ambient.tide.ampY 必须为数值')
    }
  }

  if (j.fixed !== undefined) checkFixedList(j.fixed, ctx)
  if (j.fans !== undefined) checkFansList(j.fans, ctx)
  if (j.solutions !== undefined) checkSolutionsList(j.solutions, ctx)

  return errs
}

export function parseLevelText(text: string): LevelJson {
  let raw: unknown
  try {
    raw = parseYaml(text)
  } catch (e) {
    throw new Error(`关卡 YAML 解析失败：${e instanceof Error ? e.message : String(e)}`)
  }
  const errs = validateLevelJson(raw)
  if (errs.length > 0) throw new Error(`关卡校验失败：${errs.join('；')}`)
  return raw as LevelJson
}

// validated = 调用方已走 parseLevelText/validateLevelJson（内置关卡加载路径），跳过重复校验；
// 外部输入（内联关卡 JSON、测试对象字面量）不传——校验是安全边界
export function levelFromJson(j: LevelJson, validated = false): LevelDef {
  if (!validated) {
    const errs = validateLevelJson(j)
    if (errs.length > 0) throw new Error(`关卡校验失败：${errs.join('；')}`)
  }
  const f = compileExpr(j.ground.expr)
  return { ...j, ground: f, fixed: j.fixed ?? [], fans: j.fans ?? [], json: j }
}
