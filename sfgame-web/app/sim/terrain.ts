// 地形 SDF 烘焙场：加载期把 sdf(x,y) 表达式烘焙到流体同规格的网格（单一事实源）。
// 此后所有消费方——流体固体掩码（符号）、示踪粒子（2D 采样）、纸飞机（碰撞+法向）、
// 渲染（逐顶点着色）——都采样同一份场，物理与画面逐位一致；SDF 全域有定义，天然延展到地图外
import type { Vec2 } from './types.ts'

// 飞机物理只依赖这两个操作（测试可用解析式 stub 替代烘焙场）
export interface TerrainLike {
  sample(x: number, y: number): number
  // 单位法向，指向空气（sdf 增大方向）
  normal(x: number, y: number, out: Vec2): void
}

export interface Terrain extends TerrainLike {
  readonly nx: number
  readonly ny: number
  readonly cell: number
  // 地图原点在网格内的偏移（格），与流体同义
  readonly originX: number
  readonly originY: number
  // 格心 SDF 值；mask = sdf ≤ 0（边缘格恒固体，同流体边界）
  readonly field: Float32Array
  readonly mask: Uint8Array
}

// 域 = 地图外扩边距（左/右/上等宽，与流体域同公式——烘焙场即流体网格）
export function bakeTerrain(
  sdf: (x: number, y: number) => number,
  world: { w: number; h: number },
  cell: number,
  margin: number,
): Terrain {
  const nx = Math.round((world.w + 2 * margin) / cell)
  const ny = Math.round((world.h + margin) / cell)
  const origin = Math.round(margin / cell)
  const field = new Float32Array(nx * ny)
  const mask = new Uint8Array(nx * ny)
  for (let j = 0; j < ny; j++) {
    const wy = (j - origin + 0.5) * cell
    for (let i = 0; i < nx; i++) {
      const idx = i + j * nx
      const d = sdf((i - origin + 0.5) * cell, wy)
      field[idx] = d
      mask[idx] = i === 0 || j === 0 || i === nx - 1 || j === ny - 1 || d <= 0 ? 1 : 0
    }
  }
  const terrain: Terrain = { nx, ny, cell, originX: origin, originY: origin, field, mask, sample, normal }
  return terrain

  // 双线性采样：clamp 约定与流体 sampleVelocity 同构（域外取边缘值 = 地形自然延展）
  function sample(x: number, y: number): number {
    let gx = x / cell - 0.5 + origin
    let gy = y / cell - 0.5 + origin
    if (gx < 0) gx = 0
    else if (gx > nx - 1.001) gx = nx - 1.001
    if (gy < 0) gy = 0
    else if (gy > ny - 1.001) gy = ny - 1.001
    const i0 = Math.floor(gx)
    const j0 = Math.floor(gy)
    const fx = gx - i0
    const fy = gy - j0
    const a = i0 + j0 * nx
    return (
      field[a] * (1 - fx) * (1 - fy) +
      field[a + 1] * fx * (1 - fy) +
      field[a + nx] * (1 - fx) * fy +
      field[a + nx + 1] * fx * fy
    )
  }

  // 中心差分梯度归一：步长 = cell（比单格差分平滑，跨格连续）
  function normal(x: number, y: number, out: Vec2): void {
    const dx = sample(x + cell, y) - sample(x - cell, y)
    const dy = sample(x, y + cell) - sample(x, y - cell)
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) {
      out.x = 0
      out.y = -1
    } else {
      out.x = dx / len
      out.y = dy / len
    }
  }
}

// 自顶向下第一表面（旗杆/出生点贴地用）：列内找首个 sdf ≤ 0 的格心并在相邻格心间线性细化；
// 无表面（整列空气）返回世界底部
export function surfaceY(t: Terrain, x: number, worldH: number): number {
  let gx = x / t.cell - 0.5 + t.originX
  if (gx < 0) gx = 0
  else if (gx > t.nx - 1.001) gx = t.nx - 1.001
  const col = Math.round(gx)
  for (let j = 1; j < t.ny; j++) {
    const idx = col + j * t.nx
    if (t.field[idx] > 0) continue
    const prev = t.field[idx - t.nx]
    const frac = prev > 0 ? prev / (prev - t.field[idx]) : 0
    return (j - 1 + frac - t.originY + 0.5) * t.cell
  }
  return worldH
}

// 把点沿法向推出实体直到 clearance 净空（放源吸附：脚下放源不被拒绝）。
// 单步长夹在半格内做梯度上升：SDF 在实体深处并非精确距离，整步长（clearance−d）会过冲穿过薄山体
// 飞到远端错误表面；夹步沿场梯度逐格爬升，恒收敛到最近表面，无论点击多深都不会乱飞
const SNAP_STEP = 0.5
const SNAP_ITERS = 128
export function projectOut(t: Terrain, x: number, y: number, clearance: number): { x: number; y: number } {
  const n = { x: 0, y: 0 }
  let px = x
  let py = y
  for (let k = 0; k < SNAP_ITERS; k++) {
    const d = t.sample(px, py)
    if (d >= clearance) break
    t.normal(px, py, n)
    const step = Math.min(clearance - d, t.cell * SNAP_STEP)
    px += n.x * step
    py += n.y * step
  }
  return { x: px, y: py }
}
