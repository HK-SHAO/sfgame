import { buildSolidMask, Fluid, type FluidConfig, type FluidLike } from './fluid'
import type { Vec2 } from './types'

// assembly/main.ts 编译产物（bun run build:wasm）：SIMD 必需，不支持的环境落回 JS 后端
export type BackendPref = 'auto' | 'js' | 'wasm'

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
let pref: BackendPref = 'auto'
let lastCreated: 'js' | 'wasm' = 'js'

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

export function wasmReady(): boolean {
  return wasmModule !== null
}
export function setBackendPref(p: BackendPref) {
  pref = p
}
export function backendPref(): BackendPref {
  return pref
}
// 最近一次 createFluid 的实际选择（dev 展示用）
export function activeBackend(): 'js' | 'wasm' {
  return lastCreated
}

// 按当前偏好与就绪状态，createFluid 将会选择的后端
export function resolvedBackend(): 'js' | 'wasm' {
  return pref !== 'js' && wasmModule ? 'wasm' : 'js'
}

// WASM 后端流体：与 JS Fluid 同算法（assembly/），f32 SIMD 精度，混沌放大环节 f64 保轨迹品质。
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
      // init 越界（nx/ny 超编译期容量）返回 1 → 工厂回退 JS
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

  // 调试/一致性测试直读内核场（内存无增长，视图恒定）
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

export function createFluid(cfg: FluidConfig): FluidLike {
  if (pref !== 'js' && wasmModule) {
    const w = WasmFluid.create(cfg)
    if (w) {
      lastCreated = 'wasm'
      return w
    }
  }
  lastCreated = 'js'
  return new Fluid(cfg)
}
