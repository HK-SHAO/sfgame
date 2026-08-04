/**
 * wasm 流体引擎（MoonBit 编译，native/fluid.mbt）：加载、实例化与引擎选择。
 *
 * 动机：iOS 的 WKWebView（App 内嵌浏览器）无 JS JIT，解释器跑数值循环
 * 慢 10~30 倍；WebAssembly 不需要 JIT 权限，任何引擎都以接近原生的速度运行。
 * 强引擎（有 JIT）上 JS 求解器已足够快，wasm 只在弱引擎上启用——
 * 两套实现逐位一致，切换无感。
 *
 * 内存协议（与 native/fluid.mbt 头部注释对应，低地址段避开 MoonBit 堆）：
 *   偏移 0      : u（n 个 f32）
 *   偏移 n*4    : v
 *   偏移 2*n*4  : t
 *   偏移 3*n*4  : solid（n 个 u8）
 * n = nx*ny；fluid.wasm 由 `bun run build:native` 生成并提交。
 */
import { Fluid } from './fluid'
import type { FluidConfig } from './fluid'
import type { Vec2 } from './types'
export type { FluidLike } from './fluid-like'
import type { FluidLike } from './fluid-like'

/** 暂存区布局常量（与 native/fluid.mbt 一致） */
const U_OFF = 0
const SOLID_OFF_FACTOR = 12 // solid 偏移 = n * 12

interface WasmExports {
  fluid_new(...args: number[]): void
  fluid_clear(): void
  fluid_set_solid(src: number): void
  fluid_add_heat(wx: number, wy: number, amount: number): void
  fluid_step(dt: number): void
  fluid_sync_out(): void
  memory: WebAssembly.Memory
}

let wasmState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle'
let wasmExports: WasmExports | null = null
let wasmPromise: Promise<boolean> | null = null

/** 引擎选择：'auto'（弱引擎自动用 wasm）| 'js' | 'wasm'（测试/基准强制） */
export type FluidEngineMode = 'auto' | 'js' | 'wasm'
let engineMode: FluidEngineMode = 'auto'
let preferWasm = false

export function setFluidEngine(mode: FluidEngineMode) {
  engineMode = mode
}

export function fluidEngineMode(): FluidEngineMode {
  return engineMode
}

export function wasmFluidAvailable(): boolean {
  return wasmState === 'ready'
}

/**
 * 加载 wasm 求解器（幂等，懒加载）。浏览器端经 vite 的 new URL 资源引用
 * 解析为可 fetch 的 URL；node/bun 端（vitest/scripts）import.meta.url 为
 * file: 协议，node fetch 不支持 file://，改走 node:fs 直读。
 */
export async function loadFluidWasm(): Promise<boolean> {
  if (wasmState === 'ready') return true
  if (wasmState === 'failed') return false
  if (wasmPromise) return wasmPromise
  wasmPromise = (async () => {
    try {
      const url = new URL('./fluid.wasm', import.meta.url)
      let bytes: ArrayBuffer
      if (url.protocol === 'file:') {
        const { readFile } = await import('node:fs/promises')
        const buf = await readFile(url)
        bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
      } else {
        bytes = await (await fetch(url)).arrayBuffer()
      }
      const mod = await WebAssembly.compile(bytes)
      const inst = new WebAssembly.Instance(mod, {})
      wasmExports = inst.exports as unknown as WasmExports
      wasmState = 'ready'
      return true
    } catch {
      wasmState = 'failed'
      return false
    }
  })()
  return wasmPromise
}

/**
 * 引擎速度探测：与流体求解器同构的小循环。有 JIT 的引擎约 0.1~0.5ms，
 * 无 JIT 的解释器（iOS WKWebView 等）约 5~30ms——阈值分离清晰。
 * 慢引擎优先用 wasm（逐位一致，物理不变）。
 */
function jsEngineScore(): number {
  const n = 7575
  const passes = 27
  const arr = new Float32Array(n)
  arr.fill(0.5)
  let s = 0
  const t0 = performance.now()
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) s += arr[i] * 0.999
  }
  void s
  return performance.now() - t0
}

/** 启动时调用：加载 wasm + 探测引擎速度，决定是否优先 wasm。 */
export async function installFluidWasm(): Promise<boolean> {
  const ok = await loadFluidWasm()
  if (ok && jsEngineScore() >= 2.5) preferWasm = true
  return ok
}

/** 按当前引擎模式创建求解器（JS 实现永为兜底）。 */
export function createFluid(cfg: FluidConfig): FluidLike {
  if (engineMode === 'wasm' || (engineMode === 'auto' && preferWasm)) {
    if (wasmState === 'ready' && wasmExports) return new WasmFluid(cfg)
  }
  return new Fluid(cfg)
}

export class WasmFluid implements FluidLike {
  readonly nx: number
  readonly ny: number
  readonly cell: number
  readonly tMax: number
  readonly engine = 'wasm' as const
  u: Float32Array
  v: Float32Array
  t: Float32Array
  solid: Uint8Array

  private exports: WasmExports
  private n: number
  private ambientX = 0
  private ambientY = 0
  private lastBuffer: ArrayBuffer

  constructor(cfg: FluidConfig) {
    if (!wasmExports) throw new Error('wasm 求解器未加载')
    this.exports = wasmExports
    this.nx = cfg.nx
    this.ny = cfg.ny
    this.cell = cfg.cell
    this.tMax = cfg.tMax
    this.n = cfg.nx * cfg.ny
    wasmExports.fluid_new(
      cfg.nx, cfg.ny, cfg.cell,
      cfg.buoyancy, cfg.tMax, cfg.heatRate, cfg.sourceRadius,
      cfg.velDamping, cfg.tDamping, cfg.iterations, cfg.vorticity,
    )
    this.lastBuffer = wasmExports.memory.buffer
    this.u = new Float32Array(this.lastBuffer, U_OFF, this.n)
    this.v = new Float32Array(this.lastBuffer, this.n * 4, this.n)
    this.t = new Float32Array(this.lastBuffer, this.n * 8, this.n)
    this.solid = new Uint8Array(this.lastBuffer, this.n * SOLID_OFF_FACTOR, this.n)
  }

  /** memory 增长会置换 buffer，视图需重建（正常路径永不发生）。 */
  private refresh() {
    const buf = this.exports.memory.buffer
    if (buf === this.lastBuffer) return
    this.lastBuffer = buf
    this.u = new Float32Array(buf, U_OFF, this.n)
    this.v = new Float32Array(buf, this.n * 4, this.n)
    this.t = new Float32Array(buf, this.n * 8, this.n)
    this.solid = new Uint8Array(buf, this.n * SOLID_OFF_FACTOR, this.n)
  }

  clear() {
    this.refresh()
    this.exports.fluid_clear()
    this.exports.fluid_sync_out()
  }

  setAmbient(x: number, y: number) {
    this.ambientX = x
    this.ambientY = y
  }

  setGroundMask(groundY: (x: number) => number) {
    this.refresh()
    const { nx, ny, cell, solid } = this
    solid.fill(0)
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const cx = (i + 0.5) * cell
        const cy = (j + 0.5) * cell
        const edge = i === 0 || j === 0 || i === nx - 1 || j === ny - 1
        solid[i + j * nx] = edge || cy >= groundY(cx) ? 1 : 0
      }
    }
    this.exports.fluid_set_solid(this.n * SOLID_OFF_FACTOR)
  }

  addHeat(wx: number, wy: number, amount: number) {
    this.exports.fluid_add_heat(wx, wy, amount)
  }

  /** 双线性采样速度场（与 JS 实现同构，读暂存区视图）。 */
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
    this.exports.fluid_step(dt)
    this.exports.fluid_sync_out()
  }
}
