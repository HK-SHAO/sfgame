import { parse as parseYaml } from 'yaml'
import { compileExpr, ExprError } from './expr'
import type { LevelDef, LevelJson } from './types'

// 关卡协议版本：YAML 顶层必须为 1
export const LEVEL_SCHEMA = 1

const isFin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isInt = (v: unknown): v is number => isFin(v) && Number.isInteger(v)

// 返回错误清单（空 = 合法），只列事实不猜意图、不抛错
export function validateLevelJson(raw: unknown): string[] {
  const errs: string[] = []
  const j = raw as LevelJson
  if (!j || typeof j !== 'object') return ['不是对象']
  const id = `(id=${(j as { id?: unknown }).id})`

  if (j.schema !== LEVEL_SCHEMA) errs.push(`${id} schema 必须为 ${LEVEL_SCHEMA}`)
  if (!isInt(j.id) || j.id < 1) errs.push(`${id} id 必须为正整数`)
  for (const k of ['name', 'tagline'] as const) {
    if (typeof j[k] !== 'string' || j[k].length === 0) errs.push(`${id} ${k} 必须为非空字符串`)
  }
  if (!j.win || typeof j.win.title !== 'string' || !j.win.title || typeof j.win.text !== 'string' || !j.win.text) {
    errs.push(`${id} win.title/text 必须为非空字符串`)
  }

  const w = j.world
  if (!w || !isFin(w.w) || w.w <= 0 || !isFin(w.h) || w.h <= 0 || !isFin(w.cell) || w.cell <= 0) {
    errs.push(`${id} world.w/h/cell 必须为正数`)
  } else {
    const nx = Math.round(w.w / w.cell)
    const ny = Math.round(w.h / w.cell)
    if (nx < 16 || nx > 256 || ny < 16 || ny > 256) errs.push(`${id} 网格 ${nx}×${ny} 超出 16..256 范围`)
  }

  const g = j.ground
  if (!g || typeof g.expr !== 'string' || g.expr.trim().length === 0) {
    errs.push(`${id} ground.expr 必须为非空表达式字符串`)
  } else if (w) {
    let f: ((x: number) => number) | null = null
    try {
      f = compileExpr(g.expr)
    } catch (e) {
      errs.push(`${id} ground.expr 语法错误：${e instanceof ExprError ? e.message : String(e)}`)
    }
    if (f) {
      let outOfWorld = 0
      try {
        for (let x = 0; x <= w.w + 1e-9; x += 0.5) {
          const y = f(x)
          if (!Number.isFinite(y) || y <= 0.5 || y >= w.h - 0.5) outOfWorld++
        }
      } catch (e) {
        outOfWorld = -1
        errs.push(`${id} ground.expr 求值错误：${e instanceof ExprError ? e.message : String(e)}`)
      }
      if (outOfWorld > 0) errs.push(`${id} ground.expr 在 ${outOfWorld} 个采样点超出世界高度 (0.5, h-0.5)`)
    }
  }

  const b = j.budget
  if (!b || !isInt(b.hot) || b.hot < 0 || !isInt(b.cold) || b.cold < 0) {
    errs.push(`${id} budget.hot/cold 必须为非负整数`)
  }

  const s = j.spawn
  // world 非法时以 0 兜底：校验器只列事实，不得因缺字段抛 TypeError
  const wMax = w ? w.w : 0
  const hMax = w ? w.h : 0
  if (!s || !isFin(s.x) || s.x < -20 || s.x > wMax + 20) errs.push(`${id} spawn.x 超出 [-20, w+20]`)
  if (s?.y !== undefined && (!isFin(s.y) || s.y < -20 || s.y > hMax + 20)) errs.push(`${id} spawn.y 超出范围`)
  if (s?.vx !== undefined && !isFin(s.vx)) errs.push(`${id} spawn.vx 必须为数值`)
  if (s?.vy !== undefined && !isFin(s.vy)) errs.push(`${id} spawn.vy 必须为数值`)

  if (!Array.isArray(j.goals) || j.goals.length === 0) {
    errs.push(`${id} goals 至少 1 个站点`)
  } else {
    for (let i = 0; i < j.goals.length; i++) {
      const go = j.goals[i]
      if (!go || !isFin(go.x) || go.x < 0 || go.x > wMax || !isFin(go.r) || go.r <= 0 || go.r > 15) {
        errs.push(`${id} goals[${i}] 需满足 0≤x≤w、0<r≤15`)
      }
    }
  }

  const a = j.ambient
  if (a !== undefined) {
    if (!isFin(a.x) || !isFin(a.y)) errs.push(`${id} ambient.x/y 必须为数值`)
    if (a.tide !== undefined) {
      if (!isFin(a.tide.period) || a.tide.period <= 0) errs.push(`${id} ambient.tide.period 必须为正数`)
      if (a.tide.phase !== undefined && !isFin(a.tide.phase)) errs.push(`${id} ambient.tide.phase 必须为数值`)
      if (a.tide.ampX !== undefined && !isFin(a.tide.ampX)) errs.push(`${id} ambient.tide.ampX 必须为数值`)
      if (a.tide.ampY !== undefined && !isFin(a.tide.ampY)) errs.push(`${id} ambient.tide.ampY 必须为数值`)
    }
  }

  if (j.fixed !== undefined) {
    if (!Array.isArray(j.fixed) || j.fixed.length > 8) errs.push(`${id} fixed 必须为数组且 ≤8 个`)
    else {
      for (let i = 0; i < j.fixed.length; i++) {
        const f = j.fixed[i]
        if (!f || !isFin(f.x) || f.x < 0 || f.x > wMax || !isFin(f.y) || f.y <= 0 || f.y > hMax) {
          errs.push(`${id} fixed[${i}] 需满足 0≤x≤w、0<y≤h`)
          continue
        }
        if (f.kind !== 'hot' && f.kind !== 'cold') errs.push(`${id} fixed[${i}] kind 必须为 hot|cold`)
        if (f.power !== undefined && (!isFin(f.power) || f.power <= 0)) {
          errs.push(`${id} fixed[${i}] power 必须为正数`)
        }
      }
    }
  }

  if (j.fans !== undefined) {
    if (!Array.isArray(j.fans) || j.fans.length > 8) errs.push(`${id} fans 必须为数组且 ≤8 个`)
    else {
      for (let i = 0; i < j.fans.length; i++) {
        const f = j.fans[i]
        if (
          !f ||
          !isFin(f.x) ||
          f.x < 0 ||
          f.x > wMax ||
          !isFin(f.y) ||
          f.y <= 0 ||
          f.y > hMax ||
          !isFin(f.dir) ||
          !isFin(f.power) ||
          f.power <= 0
        ) {
          errs.push(`${id} fans[${i}] 需含数值 x/y/dir 与正数 power`)
          continue
        }
        if (f.swing !== undefined && (!isFin(f.swing) || f.swing < 0 || f.swing > Math.PI)) {
          errs.push(`${id} fans[${i}] swing 需在 [0, π]`)
        }
        if (f.period !== undefined && (!isFin(f.period) || f.period <= 0)) {
          errs.push(`${id} fans[${i}] period 必须为正数`)
        }
      }
    }
  }

  if (j.solutions !== undefined) {
    if (!Array.isArray(j.solutions)) errs.push(`${id} solutions 必须为数组`)
    else {
      for (let i = 0; i < j.solutions.length; i++) {
        const sol = j.solutions[i]
        if (!sol || typeof sol.name !== 'string' || !sol.name || !Array.isArray(sol.sources) || !isFin(sol.winTime) || sol.winTime <= 0) {
          errs.push(`${id} solutions[${i}] 需含非空 name、sources 数组与正数 winTime`)
          continue
        }
        let hot = 0
        let cold = 0
        for (const src of sol.sources) {
          if (!src || !isFin(src.x) || !isFin(src.y) || (src.kind !== 'hot' && src.kind !== 'cold')) {
            errs.push(`${id} solutions[${i}] 源需为 {x,y,kind:'hot'|'cold'}`)
            continue
          }
          if (src.kind === 'hot') hot++
          else cold++
        }
        if (b && (hot > b.hot || cold > b.cold)) errs.push(`${id} solutions[${i}] 源数量超出预算`)
      }
    }
  }

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

export function levelFromJson(j: LevelJson): LevelDef {
  const errs = validateLevelJson(j)
  if (errs.length > 0) throw new Error(`关卡校验失败：${errs.join('；')}`)
  const f = compileExpr(j.ground.expr)
  return { ...j, ground: f, fixed: j.fixed ?? [], fans: j.fans ?? [], json: j }
}
