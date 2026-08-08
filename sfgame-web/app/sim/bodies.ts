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
// 上坡爬升代价倍数（非物理护栏，与地效同类）：贴地上坡方向的风驱动按重力切向分量
// ×此倍数付代价（等效风目标扣减），风有富余才推得动——防水平风无成本爬墙；
// 下坡滑行与惯性滑爬（无风驱动）不受影响
const CLIMB_COST = 2.0

// 贴地区（地面边界层）：离地低于 GROUND_EFFECT_H 风耦合按贴地度衰减至 GROUND_AERO_MIN——
// 唯一非现实护栏（地效反直觉：现实地效增强升力）：防贴地悬停成为最优策略（贴地悬停需风 ≈1.25 倍）
const GROUND_EFFECT_H = 1.5
const GROUND_AERO_MIN = 0.8
// 坡面重力切向分量用中心差分坡度（tanθ），切向加速度 = g·sinθcosθ = g·slope/(1+slope²)
const SLOPE_EPS = 0.5
// 边界层检测高度（中心基准）：风耦合衰减与贴地沉降的触发区，非接触高度——
// 接触以最低轮廓点为准（vertexRestY），飞机真正触地才接地
const REST_OFFSET = 1.1
// 边界层内未触地时的限速沉降速率（u/s）：落地/躺平自然，不瞬移
const GROUND_SETTLE_RATE = 2.5
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

// 停稳双点接地姿态：机头与指定翼尖同时触地（f(a)=两点触地中心高度差，二分求根）。
// 均匀坡/平地退化为 坡角+PLANE_TILT；强弯曲地形（坡脚）避免单点机头支撑的"按地悬空"。
// ±π/2 内无根返回 null（回退底边贴坡目标）
function twoPointRestAngle(
  body: Body,
  groundY: (x: number) => number,
  wing: readonly [number, number],
): number | null {
  const f = (a: number) => {
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    const restN = groundY(body.x + PLANE_LOCAL[0][0] * ca) - PLANE_LOCAL[0][0] * sa
    const restW = groundY(body.x + wing[0] * ca - wing[1] * sa) - (wing[0] * sa + wing[1] * ca)
    return restN - restW
  }
  let lo = body.angle - Math.PI / 2
  let hi = body.angle + Math.PI / 2
  let flo = f(lo)
  const fhi = f(hi)
  if (flo * fhi > 0) return null
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    const fm = f(mid)
    if (fm * flo <= 0) hi = mid
    else {
      lo = mid
      flo = fm
    }
  }
  return (lo + hi) / 2
}

export function stepBody(
  body: Body,
  fluid: FluidLike,
  dt: number,
  groundY: (x: number) => number,
  world: WorldBounds,
) {
  const px = body.x
  const py = body.y
  fluid.sampleVelocity(body.x, body.y, tmpAir)
  const r = body.radius
  const hAbove = Math.max(0, groundY(px) - body.y - REST_OFFSET)
  const eff = Math.min(1, hAbove / GROUND_EFFECT_H)
  const airK = 1 - (1 - eff) * (1 - GROUND_AERO_MIN)
  const k = Math.min(1, body.dragK * dt) * airK
  // 坡面（中心差分）：上坡代价、坡面下滑与姿态共用
  const slope = (groundY(body.x + SLOPE_EPS) - groundY(body.x - SLOPE_EPS)) / (2 * SLOPE_EPS)
  // 上坡代价：贴地且风朝上坡方向吹时，风目标扣掉重力切向代价（连续力语义：收敛率 K 除回）
  let airX = tmpAir.x
  if (body.y >= vertexRestY(body, groundY) - 0.05 && airX * slope < 0) {
    const cost = (body.gravity * Math.abs(slope) * CLIMB_COST) / (Math.sqrt(1 + slope * slope) * body.dragK * airK)
    airX -= Math.sign(airX) * cost
  }
  body.vx += (airX - body.vx) * k
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

  // 最低轮廓点接触高度（顶点贴合）：接触与贴地判定以它为准，中心基准只作边界层检测
  const rest = vertexRestY(body, groundY)
  const speed = Math.sqrt(body.vx * body.vx + body.vy * body.vy)
  // 慢速近地（距接触线 1.5 内）：沉降与姿态折叠的触发区——快飞不受影响，正常下降不拉拽
  const nearGround = rest - body.y < GROUND_EFFECT_H && speed < ATT_SPEED
  let grounded = false
  if (body.y > rest) {
    // 实际触地（最低轮廓点穿地）：崖壁护栏 + 反弹 + 库仑摩擦——触地才接地，边界层内不再提前"吸"住
    const dx = body.x - px
    const pground = groundY(px) - REST_OFFSET
    const ground = groundY(body.x) - REST_OFFSET
    // 机头扫过的地形是否真抬升：机头先够到陡坡时中心基准看不见（地形在机头处骤升），
    // 逐帧 snap 抬升能把飞机"爬墙"送上山肩（挂机通关漏洞）；抬升超 2:1 判墙，缓坡滑爬不受影响
    const nxv = body.x + PLANE_LOCAL[0][0]
    const aheadRise = (groundY(nxv) < groundY(nxv - dx)) ? groundY(nxv - dx) - groundY(nxv) : 0
    if (
      Math.abs(dx) > 1e-6 &&
      (pground - ground > MAX_SLIDE_SLOPE * Math.abs(dx) || aheadRise > MAX_SLIDE_SLOPE * Math.abs(dx))
    ) {
      // 撞墙帧位置整体退回（x 与 y 都回 px/py）
      body.x = px
      body.y = py
      body.vx = Math.sign(-dx) * Math.abs(body.vx) * WALL_RESTITUTION
      if (body.vy > 0) body.vy = -body.vy * 0.1
    } else {
      body.y = rest
      if (body.vy > 0) body.vy = -body.vy * 0.1
      // 库仑滑动摩擦：恒定减速度 μ·g，线性减速到停（而非指数衰减——永不归零的旧实现）
      const fric = GROUND_FRICTION_MU * body.gravity * dt
      if (body.vx > fric) body.vx -= fric
      else if (body.vx < -fric) body.vx += fric
      else body.vx = 0
    }
    grounded = true
  } else if (nearGround) {
    // 慢速近地：限速沉降到接触线（落地/躺平自然，不瞬移）——触地后姿态翻转时保持贴地
    body.y = Math.min(rest, body.y + GROUND_SETTLE_RATE * dt)
  }
  // 坡面滑行（#25）：贴地或边界层内时重力沿坡面的切向分量持续驱动下滑（仅接触帧会因逐帧微弹跳而断续）
  if (eff < 1) {
    body.vx += body.gravity * (slope / (1 + slope * slope)) * dt
  }

  // 姿态只进表现层：贴地/慢速近地 → 底边贴合地形（机轴比地形成 PLANE_TILT：有水平运动机头朝去向，
  // 停稳保留落地左右）；空中快动 → 机头朝去向；慢空冻结。无快飞预拂——快速下落保持机头朝速度，
  // 触地后由弹簧翻转自然"扑通"
  const s = Math.atan(slope)
  let target: number | null = null
  if (grounded || nearGround) {
    const c1 = s + PLANE_TILT
    const c2 = s + Math.PI - PLANE_TILT
    if (Math.abs(body.vx) > REST_MOVE_EPS) target = body.vx > 0 ? c1 : c2
    else {
      // 停稳取双点接地姿态（刚体静平衡＝两点支撑）：同侧升级 c1/c2（腹侧 ab、翻侧 af），
      // 再取近当前姿态者——避免与已收敛姿态竞争时无解回退底边贴坡
      const t1 = twoPointRestAngle(body, groundY, PLANE_LOCAL[3]) ?? c1
      const t2 = twoPointRestAngle(body, groundY, PLANE_LOCAL[1]) ?? c2
      target = Math.abs(wrapAngle(t1 - body.angle)) <= Math.abs(wrapAngle(t2 - body.angle)) ? t1 : t2
    }
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
