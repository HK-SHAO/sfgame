import type { SourceKind, Vec2 } from '../sim/types'

/** 源的放置描述（URL 状态/初始化用，无 id/born）。 */
export interface SourcePlacement {
  x: number
  y: number
  kind: SourceKind
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
  id: number
  name: string
  tagline: string
  /** 过关思路提示（显示在底部） */
  hint: string
  /** 过关结算文案：每关自己的表达，不写死在 UI 层 */
  win: { title: string; text: string }
  world: { w: number; h: number; cell: number }
  /** 地形高度（世界坐标，y 向下） */
  ground: (x: number) => number
  budget: { hot: number; cold: number }
  /** 物体出生状态：可在世界外（如画布左外侧飞入）；vx/vy 为初速度 */
  spawn: { x: number; y?: number; vx?: number; vy?: number }
  /** 目标区：以 (x, ground(x)) 上方为中心的感应圆 */
  goal: { x: number; r: number }
  /** 环境背景风（谷风等），叠加在采样风速上。默认无。 */
  ambient?: Vec2
}

export interface HudState {
  phase: 'playing' | 'won'
  hotLeft: number
  coldLeft: number
  /** 累计放置次数，用于隐藏新手引导 */
  placed: number
}

export interface PressVisual {
  kind: 'place' | 'remove'
  x: number
  y: number
  start: number
  sourceId?: number
}
