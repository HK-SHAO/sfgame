import type { SourceKind } from '../sim/types'

/** 源的放置描述（URL 状态/初始化用，无 id/born）。 */
export interface SourcePlacement {
  x: number
  y: number
  kind: SourceKind
}

/** 解法（可内嵌于关卡 JSON，供解法参考页与测试校验） */
export interface SolutionDef {
  name: string
  sources: SourcePlacement[]
  /** 无头确定性模拟实测通关时刻（秒） */
  winTime: number
}

/** 潮汐风：在常风基础上叠加周期正弦分量（period 秒一个周期）。 */
export interface TideDef {
  period: number
  phase?: number
  ampX?: number
  ampY?: number
}

export interface AmbientDef {
  x: number
  y: number
  tide?: TideDef
}

/** 站点：飞机须以"飞行姿态"依次经过（顺序 = 数组顺序）。 */
export interface GoalDef {
  x: number
  r: number
}

/**
 * 关卡协议 v1（JSON 可序列化的唯一事实来源，见 levels/*.json）。
 * 设计为"积木式"：world/ground/budget/spawn/goals/ambient 六个原子字段组合成关卡，
 * 不引入一次性特例。solutions 可选（DIY 关卡可不带，解法参考页自动跳过）。
 */
export interface LevelJson {
  schema: 1
  id: number
  name: string
  tagline: string
  /** 过关思路提示（显示在底部） */
  hint: string
  /** 过关结算文案：每关自己的表达，不写死在 UI 层 */
  win: { title: string; text: string }
  world: { w: number; h: number; cell: number }
  /** 地形公式：y = f(x) 的表达式（精准、可移植，见 expr.ts 的函数表） */
  ground: { expr: string }
  budget: { hot: number; cold: number }
  /** 物体出生状态：可在世界外（如画布左外侧飞入）；vx/vy 为初速度 */
  spawn: { x: number; y?: number; vx?: number; vy?: number }
  /** 站点序列（≥1），按顺序飞行抵达 */
  goals: GoalDef[]
  /** 环境背景风（谷风等），可叠加潮汐分量。默认无。 */
  ambient?: AmbientDef
  solutions?: SolutionDef[]
}

export interface Source {
  id: number
  kind: SourceKind
  x: number
  y: number
  /** 放置时刻（模拟时钟），用于生长动画 */
  born: number
}

export interface LevelDef {
  schema: 1
  id: number
  name: string
  tagline: string
  /** 过关思路提示（显示在底部） */
  hint: string
  /** 过关结算文案：每关自己的表达，不写死在 UI 层 */
  win: { title: string; text: string }
  world: { w: number; h: number; cell: number }
  /** 地形高度（世界坐标，y 向下）；由 JSON 折线编译而来 */
  ground: (x: number) => number
  budget: { hot: number; cold: number }
  /** 物体出生状态：可在世界外（如画布左外侧飞入）；vx/vy 为初速度 */
  spawn: { x: number; y?: number; vx?: number; vy?: number }
  /** 站点序列：按顺序飞行抵达（数组顺序即访问顺序） */
  goals: GoalDef[]
  /** 环境背景风（谷风等），可叠加潮汐。默认无。 */
  ambient?: AmbientDef
  /** 原始 JSON（序列化/往返测试用），与 ground 函数同源 */
  json: LevelJson
}

export interface HudState {
  phase: 'playing' | 'won'
  hotLeft: number
  coldLeft: number
  /** 累计放置次数，用于隐藏新手引导 */
  placed: number
  /** 模拟耗时（秒）；通关后冻结 = 通关时刻 */
  time: number
  /** 惩罚性耗时（秒）：按当前场上源数计，叠加在通关总耗时上 */
  extra: number
  /** 当前场上源数（惩罚计费依据） */
  sources: number
}

export interface PressVisual {
  kind: 'place' | 'remove'
  x: number
  y: number
  start: number
  sourceId?: number
}
