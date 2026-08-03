import type { Vec2 } from './types'

/**
 * 均匀网格上的稳定流体求解器（Jos Stam, "Real-Time Fluid Dynamics for Games"）——欧拉视角。
 *
 * 场：速度 (u, v) 与温度扰动 t（相对环境温度的偏差，热为正、冷为负）。
 * 每步：浮力 → 涡度约束 → 半拉格朗日自平流（含衰减）→ 压强投影（保持无散度）。
 *
 * 游戏物理叙事在此成立：热源加热空气 → 浮力上升 → 投影使周围冷空气补充流入，
 * 压强差自然涌现出水平风；冷源相反。世界坐标 y 向下。
 */
export interface FluidConfig {
  /** 网格列数 / 行数 */
  nx: number
  ny: number
  /** 单元格边长（世界单位） */
  cell: number
  /** 每单位温度产生的浮力加速度（世界单位/s²） */
  buoyancy: number
  /** 温度绝对值上限 */
  tMax: number
  /** 源每秒注入的温度量（中心处） */
  heatRate: number
  /** 源的注入半径（世界单位） */
  sourceRadius: number
  /** 速度每步保留比例（数值阻尼） */
  velDamping: number
  /** 温度每步保留比例（向环境回归） */
  tDamping: number
  /** 压强投影的 Gauss-Seidel 迭代次数 */
  iterations: number
  /** 涡度约束强度（0 关闭） */
  vorticity: number
}

export class Fluid {
  readonly nx: number
  readonly ny: number
  readonly cell: number
  private cfg: FluidConfig

  u: Float32Array
  v: Float32Array
  t: Float32Array
  solid: Uint8Array

  private u0: Float32Array
  private v0: Float32Array
  private t0: Float32Array
  private p: Float32Array
  private div: Float32Array
  private curl: Float32Array

  constructor(cfg: FluidConfig) {
    this.cfg = cfg
    this.nx = cfg.nx
    this.ny = cfg.ny
    this.cell = cfg.cell
    const n = cfg.nx * cfg.ny
    this.u = new Float32Array(n)
    this.v = new Float32Array(n)
    this.t = new Float32Array(n)
    this.solid = new Uint8Array(n)
    this.u0 = new Float32Array(n)
    this.v0 = new Float32Array(n)
    this.t0 = new Float32Array(n)
    this.p = new Float32Array(n)
    this.div = new Float32Array(n)
    this.curl = new Float32Array(n)
  }

  clear() {
    this.u.fill(0)
    this.v.fill(0)
    this.t.fill(0)
    this.p.fill(0)
  }

  private ambientX = 0
  private ambientY = 0

  /** 环境背景风（谷风等）：叠加在采样结果上，平流场本身不受扰动。 */
  setAmbient(x: number, y: number) {
    this.ambientX = x
    this.ambientY = y
  }

  /** 地形高度函数以下（含）的单元格视为固体壁。同时封闭网格四边。 */
  setGroundMask(groundY: (x: number) => number) {
    const { nx, ny, cell } = this
    this.solid.fill(0)
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const cx = (i + 0.5) * cell
        const cy = (j + 0.5) * cell
        const edge = i === 0 || j === 0 || i === nx - 1 || j === ny - 1
        this.solid[i + j * nx] = edge || cy >= groundY(cx) ? 1 : 0
      }
    }
  }

  private blocked(i: number, j: number): boolean {
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return true
    return this.solid[i + j * this.nx] === 1
  }

  /** 在世界坐标 (wx, wy) 附近注入温度（热为正、冷为负），按半径线性衰减。 */
  addHeat(wx: number, wy: number, amount: number) {
    const { cell, nx, ny, t } = this
    const gr = this.cfg.sourceRadius / cell
    const gx = wx / cell - 0.5
    const gy = wy / cell - 0.5
    const x0 = Math.max(1, Math.floor(gx - gr))
    const x1 = Math.min(nx - 2, Math.ceil(gx + gr))
    const y0 = Math.max(1, Math.floor(gy - gr))
    const y1 = Math.min(ny - 2, Math.ceil(gy + gr))
    const tMax = this.cfg.tMax
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const idx = i + j * nx
        if (this.solid[idx]) continue
        const d = Math.hypot(i - gx, j - gy)
        if (d >= gr) continue
        const falloff = 1 - d / gr
        let val = t[idx] + amount * falloff
        if (val > tMax) val = tMax
        else if (val < -tMax) val = -tMax
        t[idx] = val
      }
    }
  }

  /** 双线性采样速度场（世界单位/s），结果写入 out。 */
  sampleVelocity(wx: number, wy: number, out: Vec2) {
    const { nx, ny, cell, u, v } = this
    let gx = wx / cell - 0.5
    let gy = wy / cell - 0.5
    if (gx < 0) gx = 0
    else if (gx > nx - 1.001) gx = nx - 1.001
    if (gy < 0) gy = 0
    else if (gy > ny - 1.001) gy = ny - 1.001
    const i0 = Math.floor(gx)
    const j0 = Math.floor(gy)
    const fx = gx - i0
    const fy = gy - j0
    const i1 = i0 + 1
    const j1 = j0 + 1
    const a = i0 + j0 * nx
    const b = i1 + j0 * nx
    const c = i0 + j1 * nx
    const d = i1 + j1 * nx
    out.x =
      u[a] * (1 - fx) * (1 - fy) +
      u[b] * fx * (1 - fy) +
      u[c] * (1 - fx) * fy +
      u[d] * fx * fy
    out.y =
      v[a] * (1 - fx) * (1 - fy) +
      v[b] * fx * (1 - fy) +
      v[c] * (1 - fx) * fy +
      v[d] * fx * fy
    out.x += this.ambientX
    out.y += this.ambientY
  }

  /** 双线性采样温度场。 */
  sampleTemp(wx: number, wy: number): number {
    const { nx, ny, cell, t } = this
    let gx = wx / cell - 0.5
    let gy = wy / cell - 0.5
    if (gx < 0) gx = 0
    else if (gx > nx - 1.001) gx = nx - 1.001
    if (gy < 0) gy = 0
    else if (gy > ny - 1.001) gy = ny - 1.001
    const i0 = Math.floor(gx)
    const j0 = Math.floor(gy)
    const fx = gx - i0
    const fy = gy - j0
    const a = i0 + j0 * nx
    const b = i0 + 1 + j0 * nx
    const c = i0 + (j0 + 1) * nx
    const d = i0 + 1 + (j0 + 1) * nx
    return (
      t[a] * (1 - fx) * (1 - fy) +
      t[b] * fx * (1 - fy) +
      t[c] * (1 - fx) * fy +
      t[d] * fx * fy
    )
  }

  step(dt: number) {
    this.applyBuoyancy(dt)
    if (this.cfg.vorticity > 0) this.applyVorticity(dt)

    this.u0.set(this.u)
    this.v0.set(this.v)
    this.t0.set(this.t)
    this.advect(this.u, this.u0, dt, this.cfg.velDamping)
    this.advect(this.v, this.v0, dt, this.cfg.velDamping)
    this.advect(this.t, this.t0, dt, this.cfg.tDamping)

    this.project()
    this.enforceBoundary()
  }

  private applyBuoyancy(dt: number) {
    const { nx, ny, v, t, solid } = this
    const k = this.cfg.buoyancy * dt
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const idx = i + j * nx
        if (solid[idx]) continue
        v[idx] -= k * t[idx]
      }
    }
  }

  private applyVorticity(dt: number) {
    const { nx, ny, u, v, solid, curl, cell } = this
    const h2 = 2 * cell
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const idx = i + j * nx
        if (solid[idx]) {
          curl[idx] = 0
          continue
        }
        curl[idx] = (v[idx + 1] - v[idx - 1]) / h2 - (u[idx + nx] - u[idx - nx]) / h2
      }
    }
    const f = this.cfg.vorticity * cell * dt
    for (let j = 2; j < ny - 2; j++) {
      for (let i = 2; i < nx - 2; i++) {
        const idx = i + j * nx
        if (solid[idx]) continue
        const dwdx = (Math.abs(curl[idx + 1]) - Math.abs(curl[idx - 1])) / h2
        const dwdy = (Math.abs(curl[idx + nx]) - Math.abs(curl[idx - nx])) / h2
        const len = Math.hypot(dwdx, dwdy) + 1e-5
        const nxN = dwdx / len
        const nyN = dwdy / len
        const w = curl[idx]
        u[idx] += f * nyN * w
        v[idx] -= f * nxN * w
      }
    }
  }

  private advect(dst: Float32Array, src: Float32Array, dt: number, damping: number) {
    const { nx, ny, u0, v0, solid, cell } = this
    const dt0 = dt / cell
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const idx = i + j * nx
        if (solid[idx]) {
          dst[idx] = 0
          continue
        }
        let x = i - dt0 * u0[idx]
        let y = j - dt0 * v0[idx]
        if (x < 0.5) x = 0.5
        else if (x > nx - 1.5) x = nx - 1.5
        if (y < 0.5) y = 0.5
        else if (y > ny - 1.5) y = ny - 1.5
        const i0 = Math.floor(x)
        const j0 = Math.floor(y)
        const fx = x - i0
        const fy = y - j0
        const a = i0 + j0 * nx
        const b = a + 1
        const c = a + nx
        const d = c + 1
        dst[idx] =
          (src[a] * (1 - fx) * (1 - fy) +
            src[b] * fx * (1 - fy) +
            src[c] * (1 - fx) * fy +
            src[d] * fx * fy) *
          damping
      }
    }
  }

  private project() {
    const { nx, ny, u, v, p, div, solid, cell } = this
    const h = cell
    const inv2h = 1 / (2 * h)

    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const idx = i + j * nx
        if (solid[idx]) {
          div[idx] = 0
          p[idx] = 0
          continue
        }
        const uR = solid[idx + 1] ? 0 : u[idx + 1]
        const uL = solid[idx - 1] ? 0 : u[idx - 1]
        const vD = solid[idx + nx] ? 0 : v[idx + nx]
        const vU = solid[idx - nx] ? 0 : v[idx - nx]
        div[idx] = (uR - uL + vD - vU) * inv2h
        p[idx] = 0
      }
    }

    const h2 = h * h
    for (let it = 0; it < this.cfg.iterations; it++) {
      for (let j = 1; j < ny - 1; j++) {
        for (let i = 1; i < nx - 1; i++) {
          const idx = i + j * nx
          if (solid[idx]) continue
          const pL = this.blocked(i - 1, j) ? p[idx] : p[idx - 1]
          const pR = this.blocked(i + 1, j) ? p[idx] : p[idx + 1]
          const pU = this.blocked(i, j - 1) ? p[idx] : p[idx - nx]
          const pD = this.blocked(i, j + 1) ? p[idx] : p[idx + nx]
          p[idx] = (pL + pR + pU + pD - h2 * div[idx]) / 4
        }
      }
    }

    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const idx = i + j * nx
        if (solid[idx]) continue
        const pL = this.blocked(i - 1, j) ? p[idx] : p[idx - 1]
        const pR = this.blocked(i + 1, j) ? p[idx] : p[idx + 1]
        const pU = this.blocked(i, j - 1) ? p[idx] : p[idx - nx]
        const pD = this.blocked(i, j + 1) ? p[idx] : p[idx + nx]
        u[idx] -= (pR - pL) * inv2h
        v[idx] -= (pD - pU) * inv2h
      }
    }
  }

  private enforceBoundary() {
    const { u, v, t, solid } = this
    for (let idx = 0; idx < u.length; idx++) {
      if (solid[idx]) {
        u[idx] = 0
        v[idx] = 0
        t[idx] = 0
      }
    }
  }
}
