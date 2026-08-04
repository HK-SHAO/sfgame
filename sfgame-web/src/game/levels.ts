import type { LevelDef } from './types'

function clamp01(t: number) {
  return t < 0 ? 0 : t > 1 ? 1 : t
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t)
}

/**
 * 第 1 关 · 纸飞机起飞 —— 核心物理概念：上升气流。
 *
 * 布局：纸飞机从画布左外侧高速飞入，掠过峡谷；右侧是一座高崖，崖顶有目标区。
 * 开场即物理：不操作时飞机受重力缓缓坠落、约 5 秒落地谷底，无法抵达目标；
 * 玩家需在它落地前于其下方放热源，用上升热气流托住并送上山崖。
 * 谷中有一缕持续的向右谷风（ambient），托住后自然护送飞机右行，
 * 玩家可用热源接力、冷源按压微调落点（初学关，预算宽松）。
 */
function ground1(x: number): number {
  // 左段谷底 y=48，x∈[36,48] 平滑爬升，右段高原 y=22
  return 48 - 26 * smoothstep(clamp01((x - 36) / 12))
}

export const LEVEL_1: LevelDef = {
  id: 1,
  name: '纸飞机起飞',
  tagline: '上升气流',
  hint: '在纸飞机下方轻点，放一团热源——热空气上升，会把飞机送上山崖。',
  world: { w: 76, h: 56, cell: 0.75 },
  ground: ground1,
  budget: { hot: 4, cold: 2 },
  spawn: { x: -6, y: 33, vx: 40 },
  goal: { x: 58, r: 7.5 },
  ambient: { x: 1.8, y: 0 },
}

/** 未来关卡占位（仅用于标题页展示，未实现）。 */
export const UPCOMING_LEVELS: Array<Pick<LevelDef, 'id' | 'name' | 'tagline'>> = [
  { id: 2, name: '风车镇', tagline: '水平风 / 对流传动' },
  { id: 3, name: '蒲公英的旅行', tagline: '风向与分量' },
  { id: 4, name: '热气球嘉年华', tagline: '浮力与平衡' },
  { id: 5, name: '能量循环', tagline: '风能 → 电能 → 热能' },
]

export const LEVELS: LevelDef[] = [LEVEL_1]
