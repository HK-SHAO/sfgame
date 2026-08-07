import type { SourceKind } from '../sim/types'

export interface SourcePlacement {
  x: number
  y: number
  kind: SourceKind
}

export interface SolutionDef {
  name: string
  sources: SourcePlacement[]
  winTime: number
}

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

export interface GoalDef {
  x: number
  r: number
}

// 关卡自带、玩家不可移除/撤销的热冷源（不占预算）；kind 枚举同玩家源；power 可选（默认 1，强度倍数，语义对齐 FanDef.power）
export interface FixedSourceDef {
  x: number
  y: number
  kind: SourceKind
  power?: number
}

// 风扇：持续向 dir（弧度，0 = +x，y 向下）吹出气流；swing/period 可选 = 摇头风扇
export interface FanDef {
  x: number
  y: number
  dir: number
  power: number
  swing?: number
  period?: number
}

// 关卡协议 v1（JSON 可序列化的唯一事实来源，见 levels/*.yaml）；solutions 可选（DIY 关卡可不带，dev 参考解按钮自动跳过）
export interface LevelJson {
  schema: 1
  id: number
  name: string
  tagline: string
  win: { title: string; text: string }
  world: { w: number; h: number; cell: number }
  ground: { expr: string }
  budget: { hot: number; cold: number }
  // 出生状态：可在世界外（如画布左外侧飞入）；vx/vy 为初速度
  spawn: { x: number; y?: number; vx?: number; vy?: number }
  goals: GoalDef[]
  ambient?: AmbientDef
  fixed?: FixedSourceDef[]
  fans?: FanDef[]
  solutions?: SolutionDef[]
}

export interface Source {
  id: number
  kind: SourceKind
  x: number
  y: number
  born: number
  // 仅固定源携带：注入强度倍数（玩家源无此字段，恒默认 1）
  power?: number
}

export interface LevelDef {
  schema: 1
  id: number
  name: string
  tagline: string
  win: { title: string; text: string }
  world: { w: number; h: number; cell: number }
  // 世界坐标 y 向下；由 ground.expr 编译而来
  ground: (x: number) => number
  budget: { hot: number; cold: number }
  spawn: { x: number; y?: number; vx?: number; vy?: number }
  goals: GoalDef[]
  ambient?: AmbientDef
  fixed: FixedSourceDef[]
  fans: FanDef[]
  json: LevelJson
}

export interface HudState {
  phase: 'playing' | 'won'
  hotLeft: number
  coldLeft: number
  time: number
  extra: number
  sources: number
  paused: boolean
}
