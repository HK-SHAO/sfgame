import type { Fluid } from './fluid'
import type { WorldBounds } from './types'

/**
 * 拉格朗日视角的质点刚体：受重力与"向空气速度收敛"的气动阻力驱动。
 * 纸飞机、气球等都可以用该模型表达（参数不同而已）。
 * 与流体为单向耦合：风推动物体，物体不反作用于风（Game Jam 范围取舍）。
 */
export interface Body {
  x: number
  y: number
  vx: number
  vy: number
  /** 视觉姿态（弧度），随速度方向平滑转动 */
  angle: number
  radius: number
  /** 向空气速度收敛的速率（1/s），越大越"轻" */
  dragK: number
  /** 重力加速度（世界单位/s²），y 向下为正 */
  gravity: number
  /** 内部时钟，用于待机摆动 */
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

/** 可贴地滑行的最大坡度（每单位水平位移的地形抬升量）。
 * 超过该值（如崖壁）禁止 snap 抬升——飞机不能凭水平风"瞬移爬墙"。 */
const MAX_SLIDE_SLOPE = 1.0
const WALL_RESTITUTION = 0.35
/** 贴地摩擦：每次接触后水平速度的保留比例（防被微风吹离托举位置） */
const GROUND_FRICTION = 0.3

export function stepBody(
  body: Body,
  fluid: Fluid,
  dt: number,
  groundY: (x: number) => number,
  world: WorldBounds,
) {
  const px = body.x
  fluid.sampleVelocity(body.x, body.y, tmpAir)
  const k = Math.min(1, body.dragK * dt)
  body.vx += (tmpAir.x - body.vx) * k
  body.vy += body.gravity * dt + (tmpAir.y - body.vy) * k
  body.x += body.vx * dt
  body.y += body.vy * dt

  const r = body.radius
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

  const pground = groundY(px) - r * 0.5
  const ground = groundY(body.x) - r * 0.5
  if (body.y > ground) {
    // 地形在一帧内抬升过陡（崖壁）：不沿坡"瞬移"抬升，视作墙壁横向弹回
    const dx = body.x - px
    if (dx > 1e-6 && pground - ground > MAX_SLIDE_SLOPE * dx) {
      body.x = px
      if (body.y > pground) body.y = pground
      body.vx = -Math.abs(body.vx) * WALL_RESTITUTION
      if (body.vy > 0) body.vy = -body.vy * 0.1
    } else {
      body.y = ground
      if (body.vy > 0) body.vy = -body.vy * 0.1
      body.vx *= GROUND_FRICTION
    }
  }

  const speed = Math.hypot(body.vx, body.vy)
  body.clock += dt * (1.5 + speed * 0.4)
  if (speed > 1.2) {
    const target = Math.atan2(body.vy, body.vx)
    let diff = target - body.angle
    while (diff > Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    body.angle += diff * Math.min(1, 9 * dt)
  }
}
