import type { Vec2 } from './types'

// 欧拉稳定流体（Jos Stam）：浮力 → 涡度约束 → MacCormack 二阶平流（半拉格朗日误差补偿，降耗散）→ 压强投影保持无散度；热源加热上升、投影抽走体积 → 周围补充流入涌现水平风
export interface FluidConfig {
  nx: number
  ny: number
  cell: number
  buoyancy: number
  tMax: number
  heatRate: number
  sourceRadius: number
  velDamping: number
  tDamping: number
  iterations: number
  vorticity: number
}

export class Fluid {
  readonly nx: number
  readonly ny: number
  readonly cell: number
  readonly tMax: number
  private cfg: FluidConfig

  u: Float32Array
  v: Float32Array
  t: Float32Array
  solid: Uint8Array

  private u0: Float32Array
  private v0: Float32Array
  private t0: Float32Array
  private q1: Float32Array
  private q2: Float32Array
  private p: Float32Array
  private div: Float32Array
  private divH2: Float64Array
  private curl: Float32Array
  private solidIdx = new Int32Array(0)

  constructor(cfg: FluidConfig) {
    this.cfg = cfg
    this.nx = cfg.nx
    this.ny = cfg.ny
    this.cell = cfg.cell
    this.tMax = cfg.tMax
    const n = cfg.nx * cfg.ny
    this.u = new Float32Array(n)
    this.v = new Float32Array(n)
    this.t = new Float32Array(n)
    this.solid = new Uint8Array(n)
    this.u0 = new Float32Array(n)
    this.v0 = new Float32Array(n)
    this.t0 = new Float32Array(n)
    this.q1 = new Float32Array(n)
    this.q2 = new Float32Array(n)
    this.p = new Float32Array(n)
    this.div = new Float32Array(n)
    this.divH2 = new Float64Array(n)
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

  // 环境风只叠加到采样结果，不进入平流场
  setAmbient(x: number, y: number) {
    this.ambientX = x
    this.ambientY = y
  }

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
    let n = 0
    for (let i = 0; i < this.solid.length; i++) {
      if (this.solid[i]) n++
    }
    const list = new Int32Array(n)
    n = 0
    for (let i = 0; i < this.solid.length; i++) {
      if (this.solid[i]) list[n++] = i
    }
    this.solidIdx = list
  }

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
        const dx = i - gx
        const dy = j - gy
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d >= gr) continue
        const falloff = 1 - d / gr
        let val = t[idx] + amount * falloff
        if (val > tMax) val = tMax
        else if (val < -tMax) val = -tMax
        t[idx] = val
      }
    }
  }

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
    this.advectMacCormack(this.u, this.u0, dt, this.cfg.velDamping)
    this.advectMacCormack(this.v, this.v0, dt, this.cfg.velDamping)
    this.advectMacCormack(this.t, this.t0, dt, this.cfg.tDamping)

    this.project()
    this.enforceBoundary()
  }

  private applyBuoyancy(dt: number) {
    const { nx, ny, v, t } = this
    const k = this.cfg.buoyancy * dt
    // 固体格 t=0 不变量 → v -= k*0 恒为无操作，免 solid 分支（逐位不变）
    for (let j = 1; j < ny - 1; j++) {
      const row = j * nx
      for (let i = 1; i < nx - 1; i++) {
        v[i + row] -= k * t[i + row]
      }
    }
  }

  private applyVorticity(dt: number) {
    const { nx, ny, u, v, solid, curl, cell } = this
    const h2 = 2 * cell
    for (let j = 1; j < ny - 1; j++) {
      const row = j * nx
      for (let i = 1; i < nx - 1; i++) {
        const idx = i + row
        if (solid[idx]) {
          curl[idx] = 0
          continue
        }
        curl[idx] = (v[idx + 1] - v[idx - 1]) / h2 - (u[idx + nx] - u[idx - nx]) / h2
      }
    }
    const f = this.cfg.vorticity * cell * dt
    for (let j = 2; j < ny - 2; j++) {
      const row = j * nx
      for (let i = 2; i < nx - 2; i++) {
        const idx = i + row
        if (solid[idx]) continue
        const dwdx = (Math.abs(curl[idx + 1]) - Math.abs(curl[idx - 1])) / h2
        const dwdy = (Math.abs(curl[idx + nx]) - Math.abs(curl[idx - nx])) / h2
        const len = Math.sqrt(dwdx * dwdx + dwdy * dwdy) + 1e-5
        const nxN = dwdx / len
        const nyN = dwdy / len
        const w = curl[idx]
        u[idx] += f * nyN * w
        v[idx] -= f * nxN * w
      }
    }
  }

  // MacCormack 二阶平流：q1 前向、q2 回溯 q1，q1+(src-q2)/2 误差补偿；钳制到 src 3×3 邻域极值保证不产生新极值、无条件稳定；所有场用本步开始前的速度场 (u0,v0) 回溯
  private advectMacCormack(dst: Float32Array, src: Float32Array, dt: number, damping: number) {
    const { nx, ny, solid, q1, q2 } = this
    this.advectPass(q1, src, dt, 1)
    this.advectPass(q2, q1, dt, -1)
    for (let j = 1; j < ny - 1; j++) {
      const row = j * nx
      for (let i = 1; i < nx - 1; i++) {
        const idx = i + row
        if (solid[idx]) {
          dst[idx] = 0
          continue
        }
        // 3×3 邻域极值含固体格（值 0，钳制方向安全）；展开以逐位保持原比较次序
        let lo = src[idx]
        let hi = lo
        let v: number
        v = src[idx - nx - 1]
        if (v < lo) lo = v
        else if (v > hi) hi = v
        v = src[idx - nx]
        if (v < lo) lo = v
        else if (v > hi) hi = v
        v = src[idx - nx + 1]
        if (v < lo) lo = v
        else if (v > hi) hi = v
        v = src[idx - 1]
        if (v < lo) lo = v
        else if (v > hi) hi = v
        v = src[idx]
        if (v < lo) lo = v
        else if (v > hi) hi = v
        v = src[idx + 1]
        if (v < lo) lo = v
        else if (v > hi) hi = v
        v = src[idx + nx - 1]
        if (v < lo) lo = v
        else if (v > hi) hi = v
        v = src[idx + nx]
        if (v < lo) lo = v
        else if (v > hi) hi = v
        v = src[idx + nx + 1]
        if (v < lo) lo = v
        else if (v > hi) hi = v
        let val = q1[idx] + (src[idx] - q2[idx]) * 0.5
        if (val < lo) val = lo
        else if (val > hi) val = hi
        dst[idx] = val * damping
      }
    }
  }

  // 单趟半拉格朗日平流：sign=1 回溯 / -1 前推；无条件稳定、一阶精度
  private advectPass(dst: Float32Array, src: Float32Array, dt: number, sign: number) {
    const { nx, ny, u0, v0, solid, cell } = this
    const dt0 = (dt / cell) * sign
    for (let j = 1; j < ny - 1; j++) {
      const row = j * nx
      for (let i = 1; i < nx - 1; i++) {
        const idx = i + row
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
        const i0 = x | 0
        const j0 = y | 0
        const fx = x - i0
        const fy = y - j0
        const a = i0 + j0 * nx
        const b = a + 1
        const c = a + nx
        const d = c + 1
        dst[idx] =
          src[a] * (1 - fx) * (1 - fy) +
          src[b] * fx * (1 - fy) +
          src[c] * (1 - fx) * fy +
          src[d] * fx * fy
      }
    }
  }

  private project() {
    const { nx, ny, u, v, p, div, divH2, solid, cell } = this
    const h = cell
    const inv2h = 1 / (2 * h)
    const h2 = h * h

    // p 不清零：warm-start 沿用上一帧压强做初值（流场逐帧缓变，收敛更快）
    for (let j = 1; j < ny - 1; j++) {
      const row = j * nx
      for (let i = 1; i < nx - 1; i++) {
        const idx = i + row
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
      }
    }

    const n = div.length
    for (let i = 0; i < n; i++) divH2[i] = h2 * div[i]

    // 红黑 Gauss-Seidel 交替扫描（收敛约两倍于顺序 GS）；网格四边恒为固体，内圈邻域索引必在界内
    const iterations = this.cfg.iterations
    for (let it = 0; it < iterations; it++) {
      for (let parity = 0; parity < 2; parity++) {
        for (let j = 1; j < ny - 1; j++) {
          const i0 = ((parity ^ (j & 1)) & 1) ? 1 : 2
          const row = j * nx
          for (let i = i0; i < nx - 1; i += 2) {
            const idx = i + row
            if (solid[idx]) continue
            const pL = solid[idx - 1] ? p[idx] : p[idx - 1]
            const pR = solid[idx + 1] ? p[idx] : p[idx + 1]
            const pU = solid[idx - nx] ? p[idx] : p[idx - nx]
            const pD = solid[idx + nx] ? p[idx] : p[idx + nx]
            p[idx] = (pL + pR + pU + pD - divH2[idx]) * 0.25
          }
        }
      }
    }

    for (let j = 1; j < ny - 1; j++) {
      const row = j * nx
      for (let i = 1; i < nx - 1; i++) {
        const idx = i + row
        if (solid[idx]) continue
        const pL = solid[idx - 1] ? p[idx] : p[idx - 1]
        const pR = solid[idx + 1] ? p[idx] : p[idx + 1]
        const pU = solid[idx - nx] ? p[idx] : p[idx - nx]
        const pD = solid[idx + nx] ? p[idx] : p[idx + nx]
        u[idx] -= (pR - pL) * inv2h
        v[idx] -= (pD - pU) * inv2h
      }
    }
  }

  private enforceBoundary() {
    const { u, v, t, solidIdx } = this
    for (let k = 0; k < solidIdx.length; k++) {
      const idx = solidIdx[k]
      u[idx] = 0
      v[idx] = 0
      t[idx] = 0
    }
  }
}
