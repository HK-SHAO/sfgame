import type { FluidLike } from './fluid'
import type { WorldBounds } from './types'

// 质点模型（第一性原理）：只与空气和地面交互。
// 空气 = 速度向当地风速指数收敛（dragK 越大越"轻"）+ 重力；地面 = 质点不穿地。
// 无升力/力矩/姿态动力学——angle 只是表现层：机头朝当前运动方向（≈风向，drag 使速度收敛于风）
export interface Body {
  x: number
  y: number
  vx: number
  vy: number
  angle: number
  radius: number
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
  return { x, y, vx: 0, vy: 0, angle: 0, radius: opts.radius, dragK: opts.dragK, gravity: opts.gravity }
}

// 机身局部顶点（仅渲染几何）：机头 → 左翼 → 尾心 → 右翼（y 向下、机头朝 +x）
export const PLANE_LOCAL = [
  [1.85, 0],
  [-1.35, -1.12],
  [-0.6, 0],
  [-1.35, 1.12],
] as const

const tmpAir = { x: 0, y: 0 }

// 边界反弹系数（左右上三边；地面单独处理）
const WALL_RESTITUTION = 0.35
// 纸面滑动摩擦系数 μ：接触帧以恒定减速度 μ·g 线性减速到停
const GROUND_FRICTION_MU = 0.3
// 触地垂直速度保留比例：落地"软"，不弹跳
const GROUND_BOUNCE = 0.1
// 机头向运动方向的收敛速率（1/s）：稳稳指向、不瞬移
const ATT_RATE = 10

// 角度差归一到 (−π, π]
function wrapAngle(a: number): number {
  return a - Math.PI * 2 * Math.round(a / (Math.PI * 2))
}

export function stepBody(
  body: Body,
  fluid: FluidLike,
  dt: number,
  groundY: (x: number) => number,
  world: WorldBounds,
) {
  fluid.sampleVelocity(body.x, body.y, tmpAir)
  const k = Math.min(1, body.dragK * dt)
  body.vx += (tmpAir.x - body.vx) * k
  body.vy += body.gravity * dt + (tmpAir.y - body.vy) * k
  body.x += body.vx * dt
  body.y += body.vy * dt

  // 边界墙只反弹"正在向外运动"的质点：从画布外飞入（如关卡开场）不受拦截
  const r = body.radius
  if (body.x < r && body.vx < 0) {
    body.x = r
    body.vx = Math.abs(body.vx) * WALL_RESTITUTION
  } else if (body.x > world.w - r && body.vx > 0) {
    body.x = world.w - r
    body.vx = -Math.abs(body.vx) * WALL_RESTITUTION
  }
  if (body.y < r && body.vy < 0) {
    body.y = r
    body.vy = Math.abs(body.vy) * WALL_RESTITUTION
  }

  // 地面：质点钳制在地面及以上；垂直速度大部分吸收，水平库仑摩擦减速到停
  const ground = groundY(body.x)
  if (body.y > ground) {
    body.y = ground
    if (body.vy > 0) body.vy = -body.vy * GROUND_BOUNCE
    const fric = GROUND_FRICTION_MU * body.gravity * dt
    if (body.vx > fric) body.vx -= fric
    else if (body.vx < -fric) body.vx += fric
    else body.vx = 0
  }

  // 机头朝运动方向：drag 使速度收敛于风，故即"机头稳稳指向风向"；无风落地时自然垂向坡面
  const speed = Math.hypot(body.vx, body.vy)
  if (speed > 0.01) {
    body.angle += wrapAngle(Math.atan2(body.vy, body.vx) - body.angle) * Math.min(1, ATT_RATE * dt)
  }
}
