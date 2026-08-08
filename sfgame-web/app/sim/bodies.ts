import type { FluidLike } from './fluid'
import type { WorldBounds } from './types'

// 质点模型：重力 + 向空气速度收敛的气动阻力；与流体单向耦合（风推动物体，物体不反作用于风）。
// 无升力/力矩——姿态（angle/w）只是表现层状态，从不反作用受力
export interface Body {
  x: number
  y: number
  vx: number
  vy: number
  // 表现层姿态：机头与机身的夹角（0 = 机头向右），跟随运动/地形，不参与受力
  angle: number
  // 角速度（姿态二阶动力学：落地有自然"扑通"惯性，非瞬移指向）
  w: number
  radius: number
  // 向空气速度收敛的速率（1/s），越大越"轻"
  dragK: number
  // 重力加速度（世界单位/s²），y 向下为正
  gravity: number
}

export interface BodyOptions {
  radius: number
  dragK: number
  gravity: number
}

export function createBody(x: number, y: number, opts: BodyOptions): Body {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    angle: 0,
    w: 0,
    radius: opts.radius,
    dragK: opts.dragK,
    gravity: opts.gravity,
  }
}

// 机身局部顶点（接触与渲染共用的单一几何）：机头 → 左翼 → 尾心 → 右翼（y 向下、机头朝 +x）
export const PLANE_LOCAL = [
  [1.85, 0],
  [-1.35, -1.12],
  [-0.6, 0],
  [-1.35, 1.12],
] as const
// 底边（机头→右翼尖）与机轴的夹角：休止时底边贴合地形，机轴比地形成此角（两侧边不平行 ⇒ 轴平则边斜）
const PLANE_TILT = Math.atan((PLANE_LOCAL[3][1] - PLANE_LOCAL[0][1]) / (PLANE_LOCAL[0][0] - PLANE_LOCAL[3][0]))

const tmpAir = { x: 0, y: 0 }

// 光滑地面（#25）：贴地不"粘"——低摩擦可顺坡滑行，风速足够即可重新带飞。
// 坡度过陡（如崖壁）仍禁止 snap 抬升——防止水平风"瞬移爬墙"
const MAX_SLIDE_SLOPE = 2.0
const WALL_RESTITUTION = 0.35
// 纸面滑动摩擦系数 μ：接触帧以恒定减速度 μ·g 线性减速到停（现实滑动摩擦，
// 纸面 μ≈0.3——可丝滑长滑；缓坡净驱动力不足时自然停住）
const GROUND_FRICTION_MU = 0.3

// 贴地区（地面边界层）：离地低于 GROUND_EFFECT_H 风耦合按贴地度衰减至 GROUND_AERO_MIN——
// 唯一非现实护栏（地效反直觉：现实地效增强升力）：防贴地悬停成为最优策略（贴地悬停需风 ≈1.25 倍）
const GROUND_EFFECT_H = 1.5
const GROUND_AERO_MIN = 0.8
// 坡面重力切向分量用中心差分坡度（tanθ），切向加速度 = g·sinθcosθ = g·slope/(1+slope²)
const SLOPE_EPS = 0.5
// 贴地基准高度（中心基准，仅作检测/边界层护栏）：地面检测与 hAbove 保持中心参照不变
const REST_OFFSET = 1.1
// 姿态二阶弹簧（只进表现层）：落地/转向带 ~0.4s 阻尼摆动（"扑通"惯性），近临界阻尼无可见回弹
const ATT_SPEED = 1.2
const FLOP_W0 = 10
const FLOP_W2 = FLOP_W0 * FLOP_W0
const FLOP_ZETA = 0.9
const FLOP_W_MAX = 12
// 慢速空中（无目标）：角速度指数衰减，朝向冻结而非乱转
const FLOP_DECAY = 6
// 贴地时判定"有水平运动"的速度阈值（摩擦会把 vx 归零；越过此值机头朝去向）
const REST_MOVE_EPS = 0.15

// 角度差归一到 (−π, π]
function wrapAngle(a: number): number {
  return a - Math.PI * 2 * Math.round(a / (Math.PI * 2))
}

// 顶点贴合高度：4 顶点各自 x 处地形 − 顶点 y 投影的最小值（最低轮廓点恰好着地；底边贴坡、翻转不插地）
function vertexRestY(body: Body, groundY: (x: number) => number): number {
  const ca = Math.cos(body.angle)
  const sa = Math.sin(body.angle)
  let rest = Infinity
  for (let i = 0; i < PLANE_LOCAL.length; i++) {
    const lx = PLANE_LOCAL[i][0]
    const ly = PLANE_LOCAL[i][1]
    const h = groundY(body.x + lx * ca - ly * sa) - (lx * sa + ly * ca)
    if (h < rest) rest = h
  }
  return rest
}

export function stepBody(
  body: Body,
  fluid: FluidLike,
  dt: number,
  groundY: (x: number) => number,
  world: WorldBounds,
) {
  const px = body.x
  fluid.sampleVelocity(body.x, body.y, tmpAir)
  const r = body.radius
  const hAbove = Math.max(0, groundY(px) - body.y - REST_OFFSET)
  const eff = Math.min(1, hAbove / GROUND_EFFECT_H)
  const airK = 1 - (1 - eff) * (1 - GROUND_AERO_MIN)
  const k = Math.min(1, body.dragK * dt) * airK
  body.vx += (tmpAir.x - body.vx) * k
  body.vy += body.gravity * dt + (tmpAir.y - body.vy) * k
  body.x += body.vx * dt
  body.y += body.vy * dt

  // 边界墙只反弹"正在向外运动"的物体：从画布外飞入的物体（如关卡开场）不受拦截
  if (body.x < r) {
    if (body.vx < 0) {
      body.x = r
      body.vx = Math.abs(body.vx) * WALL_RESTITUTION
    }
  } else if (body.x > world.w - r) {
    if (body.vx > 0) {
      body.x = world.w - r
      body.vx = -Math.abs(body.vx) * WALL_RESTITUTION
    }
  }
  if (body.y < r) {
    if (body.vy < 0) {
      body.y = r
      body.vy = Math.abs(body.vy) * WALL_RESTITUTION
    }
  }

  const pground = groundY(px) - REST_OFFSET
  const ground = groundY(body.x) - REST_OFFSET
  let grounded = false
  if (body.y > ground) {
    const dx = body.x - px
    if (Math.abs(dx) > 1e-6 && pground - ground > MAX_SLIDE_SLOPE * Math.abs(dx)) {
      body.x = px
      if (body.y > pground) body.y = pground
      body.vx = Math.sign(-dx) * Math.abs(body.vx) * WALL_RESTITUTION
      if (body.vy > 0) body.vy = -body.vy * 0.1
    } else {
      body.y = ground
      // 顶点贴合：接触线低于中心基准（贴地姿态）则沉降到底边着地——平地上底边齐平、斜坡整条底边贴坡；
      // 不向上抬（悬崖悬垂时顶点接触高于机身，交给 MAX_SLIDE_SLOPE 护栏与旧有中心模型）
      const rest = vertexRestY(body, groundY)
      if (rest > body.y) body.y = rest
      if (body.vy > 0) body.vy = -body.vy * 0.1
      // 库仑滑动摩擦：恒定减速度 μ·g，线性减速到停（而非指数衰减——永不归零的旧实现）
      const fric = GROUND_FRICTION_MU * body.gravity * dt
      if (body.vx > fric) body.vx -= fric
      else if (body.vx < -fric) body.vx += fric
      else body.vx = 0
    }
    grounded = true
  }
  // 坡面滑行（#25）：贴地或边界层内时重力沿坡面的切向分量持续驱动下滑（仅接触帧会因逐帧微弹跳而断续）
  const slope = (groundY(body.x + SLOPE_EPS) - groundY(body.x - SLOPE_EPS)) / (2 * SLOPE_EPS)
  if (eff < 1) {
    body.vx += body.gravity * (slope / (1 + slope * slope)) * dt
  }

  // 姿态只进表现层：贴地/近地下降 → 底边贴合地形（机轴比地形成 PLANE_TILT）；
  // 有水平运动机头朝去向，停稳保留落地左右；空中快动 → 机头朝去向；慢速空中冻结。
  // 二阶弹簧驱动（w 状态），落地有自然"扑通"
  const speed = Math.sqrt(body.vx * body.vx + body.vy * body.vy)
  const s = Math.atan(slope)
  let target: number | null = null
  if (grounded || (eff < 1 && body.vy > 0)) {
    const c1 = s + PLANE_TILT
    const c2 = s + Math.PI - PLANE_TILT
    if (Math.abs(body.vx) > REST_MOVE_EPS) target = body.vx > 0 ? c1 : c2
    else target = Math.abs(wrapAngle(c1 - body.angle)) <= Math.abs(wrapAngle(c2 - body.angle)) ? c1 : c2
  } else if (speed > ATT_SPEED) {
    target = Math.atan2(body.vy, body.vx)
  }
  if (target !== null) {
    const diff = wrapAngle(target - body.angle)
    body.w += (diff * FLOP_W2 - 2 * FLOP_ZETA * FLOP_W0 * body.w) * dt
    if (body.w > FLOP_W_MAX) body.w = FLOP_W_MAX
    else if (body.w < -FLOP_W_MAX) body.w = -FLOP_W_MAX
  } else {
    body.w *= Math.max(0, 1 - FLOP_DECAY * dt)
  }
  body.angle += body.w * dt
}
