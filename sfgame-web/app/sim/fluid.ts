// 欧拉稳定流体（Jos Stam）：浮力 → 涡度约束 → MacCormack 二阶平流（半拉格朗日误差补偿，降耗散）→ 压强投影保持无散度；热源加热上升、投影抽走体积 → 周围补充流入涌现水平风。环境风不进步流水线：预烘焙位流基场（贴地绕流，顺坡爬升），采样时按强度线性叠加。数值内核在 assembly/core.ts（WASM·SIMD，经 app/wasm/engine.ts 单实例加载），本模块只是门面与纯计算辅助
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
  // 地图外扩边距（世界单位，左/右/上等宽）：流体域大于地图，风与热可流出可见区；0 = 域即地图（测试）
  margin: number
}

// 流体公共面：质点/粒子/云/渲染按接口消费，不依赖 WASM 细节
export interface FluidLike {
  readonly nx: number
  readonly ny: number
  readonly cell: number
  clear(): void
  // 环境风强度与温度偏置：采样 = 模拟场 + 位流基场×强度；temp 在浮力/温度采样消费时叠加
  setAmbient(x: number, y: number, temp?: number): void
  setGroundMask(groundY: (x: number) => number): void
  addHeat(wx: number, wy: number, amount: number): void
  // 动量注入：以 (fx,fy) 方向在 radius 圆域内给速度场加 amount（调用方负责 dt 缩放）
  addForce(wx: number, wy: number, fx: number, fy: number, amount: number, radius: number): void
  sampleVelocity(wx: number, wy: number, out: Vec2): void
  sampleTemp(wx: number, wy: number): number
  step(dt: number): void
}

// 地面/边界固体掩码（几何与 assembly/core.ts 的 rebuildSolid 一致）。
// originX/Y（格）= 地图在网格内的原点偏移：地面函数定义在世界坐标，格中心须减回偏移
export function buildSolidMask(
  nx: number,
  ny: number,
  cell: number,
  groundY: (x: number) => number,
  originX = 0,
  originY = 0,
): Uint8Array {
  const solid = new Uint8Array(nx * ny)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const cx = (i - originX + 0.5) * cell
      const cy = (j - originY + 0.5) * cell
      const edge = i === 0 || j === 0 || i === nx - 1 || j === ny - 1
      solid[i + j * nx] = edge || cy >= groundY(cx) ? 1 : 0
    }
  }
  return solid
}

// 渲染零拷贝采样：与 assembly/core.ts sampleVelocity/sampleTemp 逐位同构（clamp [0, n-1.001]、双线性、
// 网格原点偏移 originX/Y（格）、环境风 = 基场×强度叠加）
export function bilinearSample(
  u: Float32Array,
  v: Float32Array,
  t: Float32Array,
  fxU: Float32Array,
  fxV: Float32Array,
  nx: number,
  ny: number,
  cell: number,
  originX: number,
  originY: number,
  ambientX: number,
  ambientY: number,
  wx: number,
  wy: number,
  out: Vec2,
): number {
  let gx = wx / cell - 0.5 + originX
  let gy = wy / cell - 0.5 + originY
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
  out.x =
    u[a] * w00 + u[b] * w10 + u[c] * w01 + u[d] * w11 +
    ambientX * (fxU[a] * w00 + fxU[b] * w10 + fxU[c] * w01 + fxU[d] * w11)
  out.y =
    v[a] * w00 + v[b] * w10 + v[c] * w01 + v[d] * w11 +
    ambientX * (fxV[a] * w00 + fxV[b] * w10 + fxV[c] * w01 + fxV[d] * w11) +
    ambientY
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
  private ex: EngineHandle['ex']
  private engine: EngineHandle
  private solidView: Uint8Array
  // 采样热路径零拷贝字段视图（构造期建一次；内存静态定型，视图恒定）
  private u: Float32Array
  private v: Float32Array
  private t: Float32Array
  private fxU: Float32Array
  private fxV: Float32Array

  static create(cfg: FluidConfig, engine = createEngine()): WasmFluid | null {
    try {
      // 边距取整格：JS 采样用同一整数偏移，保证与内核逐位同构
      const marginCells = Math.round(cfg.margin / cfg.cell)
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
        marginCells,
      )
      if (st !== 0) return null
      engine.origin.x = marginCells
      engine.origin.y = marginCells
      return new WasmFluid(cfg, engine)
    } catch {
      return null
    }
  }

  private constructor(cfg: FluidConfig, engine: EngineHandle) {
    this.nx = cfg.nx
    this.ny = cfg.ny
    this.cell = cfg.cell
    this.engine = engine
    this.ex = engine.ex
    const buf = engine.memory.buffer
    const n = cfg.nx * cfg.ny
    this.u = new Float32Array(buf, engine.ex.fieldU(), n)
    this.v = new Float32Array(buf, engine.ex.fieldV(), n)
    this.t = new Float32Array(buf, engine.ex.fieldT(), n)
    this.fxU = new Float32Array(buf, engine.ex.fieldFxU(), n)
    this.fxV = new Float32Array(buf, engine.ex.fieldFxV(), n)
    this.solidView = new Uint8Array(buf, engine.ex.solidBuf(), cfg.nx * cfg.ny)
  }

  clear() {
    this.ex.clear()
  }

  setAmbient(x: number, y: number, temp = 0) {
    this.ex.setAmbient(x, y, temp)
    // 引擎共享环境状态：渲染零拷贝采样据此叠加基场/温度着色（与 wasm 侧消费同语义）
    this.engine.ambient.x = x
    this.engine.ambient.y = y
    this.engine.ambient.t = temp
  }

  setGroundMask(groundY: (x: number) => number) {
    const m = this.engine.origin.x
    this.solidView.set(buildSolidMask(this.nx, this.ny, this.cell, groundY, m, m))
    this.ex.rebuildSolid()
  }

  addHeat(wx: number, wy: number, amount: number) {
    this.ex.addHeat(wx, wy, amount)
  }

  addForce(wx: number, wy: number, fx: number, fy: number, amount: number, radius: number) {
    this.ex.addForce(wx, wy, fx, fy, amount, radius)
  }

  // 零拷贝直读共享内存：与内核导出 sampleVelocity 逐位同构（bilinearSample），
  // 免掉每采样 3 次跨界调用（热路径：粒子/探针/飞机每 tick 四百余次采样）
  sampleVelocity(wx: number, wy: number, out: Vec2) {
    bilinearSample(
      this.u, this.v, this.t, this.fxU, this.fxV,
      this.nx, this.ny, this.cell,
      this.engine.origin.x, this.engine.origin.y,
      this.engine.ambient.x, this.engine.ambient.y,
      wx, wy, out,
    )
  }

  sampleTemp(wx: number, wy: number): number {
    return this.ex.sampleTemp(wx, wy)
  }

  step(dt: number) {
    this.ex.step(dt)
  }

  // 调试/测试直读内核场（内存无增长，视图恒定；与构造期缓存同视图）
  fieldViews(): { u: Float32Array; v: Float32Array; t: Float32Array; fxU: Float32Array; fxV: Float32Array } {
    return { u: this.u, v: this.v, t: this.t, fxU: this.fxU, fxV: this.fxV }
  }
}

// 唯一工厂：未加载 / 超容量（assembly 编译期 MAX_NX×MAX_NY）一律显式抛错——无声退化等于带病启动；
// engine 可选：不传自建独立实例（测试/无头脚本隔离）
export function createFluid(cfg: FluidConfig, engine?: EngineHandle): WasmFluid {
  const f = WasmFluid.create(cfg, engine)
  if (!f) throw new Error('流体 WASM 内核不可用（未加载或网格超出编译容量）')
  return f
}
