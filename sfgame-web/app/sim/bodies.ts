import type { FluidLike } from './fluid'
import type { WorldBounds } from './types'

// 质点模型：重力 + 向空气速度收敛的气动阻力；与流体单向耦合（风推动物体，物体不反作用于风）
export interface Body {
  x: number
  y: number
  vx: number
  vy: number
  angle: number
  radius: number
  // 向空气速度收敛的速率（1/s），越大越"轻"
  dragK: number
  // 重力加速度（世界单位/s²），y 向下为正
  gravity: number
  clock: number
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
    radius: opts.radius,
    dragK: opts.dragK,
    gravity: opts.gravity,
    clock: Math.random() * Math.PI * 2,
  }
}

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
// 贴地基准高度：≈ 机身视觉半高（#28）——飞机落在地面上而非机头/下半身插进土里
const REST_OFFSET = 1.1
// 贴地时角度向坡面收敛的速率
const GROUND_ALIGN_K = 9

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

  const speed = Math.sqrt(body.vx * body.vx + body.vy * body.vy)
  body.clock += dt * (1.5 + speed * 0.4)
  // #28 空气动力学手感：贴地或下降中近地时顺着地面（角度对齐坡面，机头不插地）；飞行时随速度姿态
  const target =
    grounded || (eff < 1 && body.vy > 0) ? Math.atan(slope) : speed > 1.2 ? Math.atan2(body.vy, body.vx) : null
  if (target !== null) {
    let diff = target - body.angle
    while (diff > Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    body.angle += diff * Math.min(1, GROUND_ALIGN_K * dt)
  }
}
