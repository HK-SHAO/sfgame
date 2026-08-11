import type { SourceKind } from '../sim/types.ts'

export interface SourcePlacement {
  x: number
  y: number
  kind: SourceKind
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
  // 环境温度偏置（热=上升、冷=下沉，经浮力生效；视觉同步着色示踪粒子）
  temp?: number
  tide?: TideDef
}

export interface GoalDef {
  x: number
  r: number
}

// 关卡自带、玩家不可移除/撤销的热冷源（不占预算）；power 可选（默认 1，强度倍数）
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

// 关卡协议 v1（JSON 可序列化的唯一事实来源，见 levels/*.json）；不内置参考解——玩家解法记录在本地（progress.ts，与关卡 hash 绑定）
export interface LevelJson {
  // 编辑器 schema 提示（可选字段），运行时不做版本强制（level-validate.ts）
  $schema?: string
  id: string
  name: string
  tagline: string
  win: { title: string; text: string }
  world: { w: number; h: number; cell: number }
  terrain: { sdf: string }
  budget: { hot: number; cold: number }
  // 出生状态：可在世界外（如画布左外侧飞入）；vx/vy 为初速度
  spawn: { x: number; y?: number; vx?: number; vy?: number }
  goals: GoalDef[]
  ambient?: AmbientDef
  fixed?: FixedSourceDef[]
  fans?: FanDef[]
}

export interface Source {
  id: number
  kind: SourceKind
  x: number
  y: number
  born: number
  // 墙钟出生时刻：渲染生长动画用（暂停/冻结时 sim 时钟不走，born 差值恒 0 会隐形）
  wallBorn: number
  // 仅固定源携带：注入强度倍数（玩家源无此字段，恒默认 1）
  power?: number
}

export interface LevelDef {
  id: string
  name: string
  tagline: string
  win: { title: string; text: string }
  world: { w: number; h: number; cell: number }
  // 地形 SDF：到地表的有符号距离（>0 空气 / <0 实体），世界坐标 y 向下；由 terrain.sdf 编译而来
  sdf: (x: number, y: number) => number
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
