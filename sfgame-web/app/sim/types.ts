export interface Vec2 {
  x: number
  y: number
}

export type SourceKind = 'hot' | 'cold'

export interface WorldBounds {
  w: number
  h: number
}

// 目标区圆心在地面上的抬升高度（simulation 检测与 render 虚线圆共用）
export const GOAL_LIFT = 2

// 长按放冷源的判定时长（input 判定与 render 按压力进度条共用的跨层握手协议）
export const LONG_PRESS_MS = 380

// 按住时的视觉状态：input 生成、controller 传递、render 消费
export interface PressVisual {
  kind: 'place' | 'remove'
  x: number
  y: number
  start: number
  sourceId?: number
}
