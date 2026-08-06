// 欧拉稳定流体（Jos Stam）：浮力 → 涡度约束 → MacCormack 二阶平流（半拉格朗日误差补偿，降耗散）→ 压强投影保持无散度；热源加热上升、投影抽走体积 → 周围补充流入涌现水平风。数值内核在 assembly/core.ts（WASM·SIMD，经 src/wasm/engine.ts 单实例加载），本模块只是门面与纯计算辅助
import type { Vec2 } from './types'
import { createEngine, type EngineHandle } from '../wasm/engine'

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

// 流体公共面：刚体/粒子/云/渲染按接口消费，不依赖 WASM 细节
export interface FluidLike {
  readonly nx: number
  readonly ny: number
  readonly cell: number
  readonly tMax: number
  clear(): void
  setAmbient(x: number, y: number): void
  setGroundMask(groundY: (x: number) => number): void
  addHeat(wx: number, wy: number, amount: number): void
  sampleVelocity(wx: number, wy: number, out: Vec2): void
  sampleTemp(wx: number, wy: number): number
  step(dt: number): void
}

// 地面/边界固体掩码（几何与 assembly/core.ts 的 rebuildSolid 一致）
export function buildSolidMask(
  nx: number,
  ny: number,
  cell: number,
  groundY: (x: number) => number,
): Uint8Array {
  const solid = new Uint8Array(nx * ny)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const cx = (i + 0.5) * cell
      const cy = (j + 0.5) * cell
      const edge = i === 0 || j === 0 || i === nx - 1 || j === ny - 1
      solid[i + j * nx] = edge || cy >= groundY(cx) ? 1 : 0
    }
  }
  return solid
}

// 渲染零拷贝采样：与 assembly/core.ts sampleVelocity/sampleTemp 逐位同构（clamp [0, n-1.001]、双线性、速度叠 ambient）
export function bilinearSample(
  u: Float32Array,
  v: Float32Array,
  t: Float32Array,
  nx: number,
  ny: number,
  cell: number,
  ambientX: number,
  ambientY: number,
  wx: number,
  wy: number,
  out: Vec2,
): number {
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
  const b = a + 1
  const c = a + nx
  const d = c + 1
  const w00 = (1 - fx) * (1 - fy)
  const w10 = fx * (1 - fy)
  const w01 = (1 - fx) * fy
  const w11 = fx * fy
  out.x = u[a] * w00 + u[b] * w10 + u[c] * w01 + u[d] * w11 + ambientX
  out.y = v[a] * w00 + v[b] * w10 + v[c] * w01 + v[d] * w11 + ambientY
  return (
    t[a] * (1 - fx) * (1 - fy) +
    t[b] * fx * (1 - fy) +
    t[c] * (1 - fx) * fy +
    t[d] * fx * fy
  )
}

// stub runtime 零运行期分配：内存在实例化时定型，视图生命周期内恒定，可安全缓存
export class WasmFluid implements FluidLike {
  readonly nx: number
  readonly ny: number
  readonly cell: number
  readonly tMax: number
  private ex: EngineHandle['ex']
  private engine: EngineHandle
  private solidView: Uint8Array

  static create(cfg: FluidConfig, engine = createEngine()): WasmFluid | null {
    try {
      // init 越界（nx/ny 超编译期容量）返回 1 → 拒绝创建
      const st = engine.ex.init(
        cfg.nx,
        cfg.ny,
        cfg.cell,
        cfg.buoyancy,
        cfg.tMax,
        cfg.heatRate,
        cfg.sourceRadius,
        cfg.velDamping,
        cfg.tDamping,
        cfg.iterations,
        cfg.vorticity,
      )
      if (st !== 0) return null
      return new WasmFluid(cfg, engine)
    } catch {
      return null
    }
  }

  private constructor(cfg: FluidConfig, engine: EngineHandle) {
    this.nx = cfg.nx
    this.ny = cfg.ny
    this.cell = cfg.cell
    this.tMax = cfg.tMax
    this.engine = engine
    this.ex = engine.ex
    this.solidView = new Uint8Array(engine.memory.buffer, engine.ex.solidBuf(), cfg.nx * cfg.ny)
  }

  clear() {
    this.ex.clear()
  }

  setAmbient(x: number, y: number) {
    this.ex.setAmbient(x, y)
    // 引擎共享环境状态：渲染零拷贝采样据此叠加 ambient（与 wasm 侧 sampleVelocity 同语义）
    this.engine.ambient.x = x
    this.engine.ambient.y = y
  }

  setGroundMask(groundY: (x: number) => number) {
    this.solidView.set(buildSolidMask(this.nx, this.ny, this.cell, groundY))
    this.ex.rebuildSolid()
  }

  addHeat(wx: number, wy: number, amount: number) {
    this.ex.addHeat(wx, wy, amount)
  }

  sampleVelocity(wx: number, wy: number, out: Vec2) {
    this.ex.sampleVelocity(wx, wy)
    out.x = this.ex.outX()
    out.y = this.ex.outY()
  }

  sampleTemp(wx: number, wy: number): number {
    return this.ex.sampleTemp(wx, wy)
  }

  step(dt: number) {
    this.ex.step(dt)
  }

  // 调试/测试直读内核场（内存无增长，视图恒定）
  fieldViews(): { u: Float32Array; v: Float32Array; t: Float32Array } {
    const n = this.nx * this.ny
    const buf = this.engine.memory.buffer
    return {
      u: new Float32Array(buf, this.ex.fieldU(), n),
      v: new Float32Array(buf, this.ex.fieldV(), n),
      t: new Float32Array(buf, this.ex.fieldT(), n),
    }
  }
}

// 唯一工厂：未加载 / 超容量（assembly 编译期 MAX_NX×MAX_NY）一律显式抛错——无声退化等于带病启动；
// engine 可选：不传自建独立实例（测试/无头脚本隔离）
export function createFluid(cfg: FluidConfig, engine?: EngineHandle): WasmFluid {
  const f = WasmFluid.create(cfg, engine)
  if (!f) throw new Error('流体 WASM 内核不可用（未加载或网格超出编译容量）')
  return f
}
