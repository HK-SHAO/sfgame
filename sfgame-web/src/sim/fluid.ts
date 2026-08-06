import type { Vec2 } from './types'

// 欧拉稳定流体（Jos Stam）：浮力 → 涡度约束 → MacCormack 二阶平流（半拉格朗日误差补偿，降耗散）→ 压强投影保持无散度；热源加热上升、投影抽走体积 → 周围补充流入涌现水平风。数值内核在 assembly/（AssemblyScript → WASM·SIMD），本模块只做引导与包装
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

// func () -> v128 { v128.const 0 }：validate 通过即支持 WASM SIMD（Chrome 91+/FF 89+/Safari 16.4+）
const SIMD_PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b, 0x03,
  0x02, 0x01, 0x00, 0x0a, 0x16, 0x01, 0x14, 0x00, 0xfd, 0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0x0b,
])

export function simdAvailable(): boolean {
  try {
    return typeof WebAssembly !== 'undefined' && WebAssembly.validate(SIMD_PROBE)
  } catch {
    return false
  }
}

let wasmModule: WebAssembly.Module | null = null

export function initWasm(bytes: ArrayBuffer | Uint8Array): boolean {
  try {
    // 归一为独立 ArrayBuffer：兼容 Buffer/共享内存视图，且规避 TS BufferSource 窄化
    const buf = bytes instanceof Uint8Array ? bytes.slice().buffer : bytes
    wasmModule = new WebAssembly.Module(buf)
    return true
  } catch {
    wasmModule = null
    return false
  }
}

// 平台无关引导：调用方按运行环境提供取字节实现（浏览器 fetch 资源 / node-bun 读文件）；
// SIMD 探测失败或加载失败一律返回 false，绝不抛
export async function bootWasm(load: () => Promise<ArrayBuffer | Uint8Array>): Promise<boolean> {
  if (typeof WebAssembly === 'undefined' || !simdAvailable()) return false
  try {
    return initWasm(await load())
  } catch {
    return false
  }
}

interface WasmExports {
  init(
    nx: number,
    ny: number,
    cell: number,
    buoyancy: number,
    tMax: number,
    heatRate: number,
    sourceRadius: number,
    velDamping: number,
    tDamping: number,
    iterations: number,
    vorticity: number,
  ): number
  clear(): void
  setAmbient(x: number, y: number): void
  rebuildSolid(): void
  addHeat(wx: number, wy: number, amount: number): void
  step(dt: number): void
  sampleVelocity(wx: number, wy: number): void
  outX(): number
  outY(): number
  sampleTemp(wx: number, wy: number): number
  fieldU(): number
  fieldV(): number
  fieldT(): number
  solidBuf(): number
  memory: WebAssembly.Memory
}

// stub runtime 零运行期分配：内存在实例化时定型，视图生命周期内恒定，可安全缓存
export class WasmFluid implements FluidLike {
  readonly nx: number
  readonly ny: number
  readonly cell: number
  readonly tMax: number
  private ex: WasmExports
  private solidView: Uint8Array

  static create(cfg: FluidConfig): WasmFluid | null {
    if (!wasmModule) return null
    try {
      const inst = new WebAssembly.Instance(wasmModule, {
        env: {
          abort(_msg: number, _file: number, line: number, col: number) {
            throw new Error(`流体 WASM 内核异常（行 ${line}:${col}）`)
          },
        },
      })
      const ex = inst.exports as unknown as WasmExports
      // init 越界（nx/ny 超编译期容量）返回 1 → 拒绝创建
      const st = ex.init(
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
      return new WasmFluid(cfg, ex)
    } catch {
      return null
    }
  }

  private constructor(cfg: FluidConfig, ex: WasmExports) {
    this.nx = cfg.nx
    this.ny = cfg.ny
    this.cell = cfg.cell
    this.tMax = cfg.tMax
    this.ex = ex
    this.solidView = new Uint8Array(ex.memory.buffer, ex.solidBuf(), cfg.nx * cfg.ny)
  }

  clear() {
    this.ex.clear()
  }

  setAmbient(x: number, y: number) {
    this.ex.setAmbient(x, y)
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
    const buf = this.ex.memory.buffer
    return {
      u: new Float32Array(buf, this.ex.fieldU(), n),
      v: new Float32Array(buf, this.ex.fieldV(), n),
      t: new Float32Array(buf, this.ex.fieldT(), n),
    }
  }
}

// 唯一工厂：未加载 / 超容量（assembly 编译期 MAX_NX×MAX_NY）一律显式抛错——无声退化等于带病启动
export function createFluid(cfg: FluidConfig): WasmFluid {
  const f = WasmFluid.create(cfg)
  if (!f) throw new Error('流体 WASM 内核不可用（未加载或网格超出编译容量）')
  return f
}
