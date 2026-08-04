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
  win: {
    title: '飞起来了！',
    text: '纸飞机乘着热气流抵达了目标。',
  },
  world: { w: 76, h: 56, cell: 0.75 },
  ground: ground1,
  budget: { hot: 4, cold: 2 },
  spawn: { x: -6, y: 33, vx: 40 },
  goal: { x: 58, r: 7.5 },
  ambient: { x: 1.8, y: 0 },
}

/**
 * 第 2 关 · 降落 —— 核心物理概念：下沉气流。
 *
 * 与第 1 关对称成对：第 1 关教"热主升"，这一关教"冷主降"。
 * 布局极简：一道缓缓加深的山谷，目标在右侧更深处。
 * 飞机自左侧高空入场、随风右行——不操作时它会掠过目标上空、撞上远处谷壁，
 * 玩家需在航线下方布置冷源：冷空气下沉，把飞机稳稳压进谷底目标。
 * 放得太早太低会摔在目标之前，太晚则掠过——落点的取舍即本关的谜题。
 * （设计说明：曾试验"翻山"概念——热气流沿坡托升越脊，但轻质量飞机在强热柱中
 * 轨迹混沌、对摆放过于敏感；降落概念的冷下沉路径平滑、容错宽，故选型于此。）
 */
function ground2(x: number): number {
  // 左浅右深的谷地：y=42（左）缓降至 y=50（右，x≥30）
  return 42 + 8 * smoothstep(clamp01(x / 30))
}

export const LEVEL_2: LevelDef = {
  id: 2,
  name: '降落',
  tagline: '下沉气流',
  hint: '飞机飞得太高会掠过目标。在它前方放冷源——冷空气下沉，把它稳稳压进山谷。',
  win: {
    title: '稳稳降落！',
    text: '下沉气流托着飞机缓缓落进山谷。热让风上升，冷让风下沉——落点由你定。',
  },
  world: { w: 76, h: 56, cell: 0.75 },
  ground: ground2,
  budget: { hot: 2, cold: 3 },
  spawn: { x: -5, y: 8, vx: 16 },
  goal: { x: 62, r: 7.5 },
  ambient: { x: 2.6, y: 0 },
}

/** 未来关卡占位（仅用于标题页展示，未实现）。 */
export const UPCOMING_LEVELS: Array<Pick<LevelDef, 'id' | 'name' | 'tagline'>> = [
  { id: 3, name: '蒲公英的旅行', tagline: '风向与分量' },
  { id: 4, name: '热气球嘉年华', tagline: '浮力与平衡' },
  { id: 5, name: '能量循环', tagline: '风能 → 电能 → 热能' },
]

export const LEVELS: LevelDef[] = [LEVEL_1, LEVEL_2]
