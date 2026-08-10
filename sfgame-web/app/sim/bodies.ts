import type { FluidLike } from './fluid.ts'
import type { TerrainLike } from './terrain.ts'

// 质点模型（第一性原理）：只与空气和地形交互。
// 空气 = 速度向当地风速指数收敛 + 重力；地形 = SDF 边界（法向投影接触解算，质点不穿地）。
// 无墙：飞机可上天、可飞出地图（SDF 全域有定义，天然延展），飞多远由风说了算（难度即来自此）。
// 无升力/力矩/姿态动力学——angle 只是表现层：机头朝当前运动方向（≈风向，drag 使速度收敛于风）
export interface Body {
  x: number
  y: number
  vx: number
  vy: number
  angle: number
}

// 纸飞机物理（全游戏唯一刚体，参数归口于此，不按实例配置）：
// HOVER_WIND 是"风力 vs 重力孰大"的唯一调参口径——上升风超过它抬升、不足下落（终端坠落速度同值）
const HOVER_WIND = 1.0
// 风耦合强度（1/s），响应时间 = 1/DRAG_K。按真实纸飞机估算：~3g、滑翔 ~5m/s、
// 升阻比 ~5 → 减速度 ~2m/s² → 滑翔惯性段 τ≈1s（越小越有惯性）
const DRAG_K = 1.0
const GRAVITY = DRAG_K * HOVER_WIND
// 纸面滑动摩擦系数 μ：接触帧沿切向以恒定减速度 μ·g 线性减速到停
// （摩擦角 arctan 0.3 ≈ 16.7°：更陡的坡停不住、无风自然下滑）
const GROUND_FRICTION_MU = 0.3
// 机头向运动方向的收敛速率（1/s）：稳稳指向、不瞬移
const ATT_RATE = 10

export function createBody(x: number, y: number): Body {
  return { x, y, vx: 0, vy: 0, angle: 0 }
}

// 机身局部顶点（仅渲染几何）：机头 → 左翼 → 尾心 → 右翼（y 向下、机头朝 +x）
export const PLANE_LOCAL = [
  [1.85, 0],
  [-1.35, -1.12],
  [-0.6, 0],
  [-1.35, 1.12],
] as const

const tmpAir = { x: 0, y: 0 }
const tmpN = { x: 0, y: 0 }

// 角度差归一到 (−π, π]
function wrapAngle(a: number): number {
  return a - Math.PI * 2 * Math.round(a / (Math.PI * 2))
}

export function stepBody(body: Body, fluid: FluidLike, dt: number, terrain: TerrainLike) {
  fluid.sampleVelocity(body.x, body.y, tmpAir)
  const k = Math.min(1, DRAG_K * dt)
  body.vx += (tmpAir.x - body.vx) * k
  body.vy += GRAVITY * dt + (tmpAir.y - body.vy) * k
  body.x += body.vx * dt
  body.y += body.vy * dt

  // 接触解算：穿透（sdf < 0）→ 沿法向推出、移除法向速度分量（纸不弹跳）；
  // 摩擦沿切向、切向重力分量自然生效——爬坡付出能量代价，陡坡垂直墙无法硬冲
  const d = terrain.sample(body.x, body.y)
  if (d < 0) {
    terrain.normal(body.x, body.y, tmpN)
    body.x -= tmpN.x * d
    body.y -= tmpN.y * d
    const vn = body.vx * tmpN.x + body.vy * tmpN.y
    if (vn < 0) {
      body.vx -= vn * tmpN.x
      body.vy -= vn * tmpN.y
    }
    // 投影后速度即切向分量：恒定减速度 μ·g 线性减速到停
    const sp = Math.hypot(body.vx, body.vy)
    if (sp > 0) {
      const fric = GROUND_FRICTION_MU * GRAVITY * dt
      const s = sp > fric ? (sp - fric) / sp : 0
      body.vx *= s
      body.vy *= s
    }
  }

  // 机头朝运动方向：drag 使速度收敛于风，故即"机头稳稳指向风向"；无风落地时自然垂向坡面
  const speed = Math.hypot(body.vx, body.vy)
  if (speed > 0.01) {
    body.angle += wrapAngle(Math.atan2(body.vy, body.vx) - body.angle) * Math.min(1, ATT_RATE * dt)
  }
}
