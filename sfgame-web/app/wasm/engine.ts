// WASM 引擎引导与实例化（assembly/engine.ts → sfengine.wasm）：流体内核 + 顶点批内核同一实例共享内存。
// 内存静态定型（stub runtime 零运行期分配），视图生命周期内恒定，可安全缓存。
// 门面在 sim/fluid.ts（物理）与 render/batch.ts（顶点批）；本模块不感知二者，只定义 wasm 导出面与单实例工厂

export interface FluidExports {
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
    marginCells: number,
  ): number
  clear(): void
  setAmbient(x: number, y: number): void
  rebuildSolid(): void
  addHeat(wx: number, wy: number, amount: number): void
  addForce(wx: number, wy: number, fx: number, fy: number, amount: number, radius: number): void
  step(dt: number): void
  sampleVelocity(wx: number, wy: number): void
  outX(): number
  outY(): number
  sampleTemp(wx: number, wy: number): number
  fieldU(): number
  fieldV(): number
  fieldT(): number
  solidBuf(): number
  fieldFxU(): number
  fieldFxV(): number
}

export interface BatchExports {
  bCapacity(): number
  bPtsCap(): number
  bFadeCap(): number
  bTracerCap(): number
  bTracerStride(): number
  bData(): number
  bPtsBuf(): number
  bFadeBuf(): number
  bTracerBuf(): number
  bCount(): number
  bReset(): void
  bTri(
    x0: number, y0: number, x1: number, y1: number, x2: number, y2: number,
    r: number, g: number, b: number, a: number,
  ): void
  bRect(x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, a: number): void
  bRectVGrad(
    x0: number, y0: number, x1: number, y1: number,
    r0: number, g0: number, b0: number, a0: number,
    r1: number, g1: number, b1: number, a1: number,
  ): void
  bStroke(
    x0: number, y0: number, x1: number, y1: number, w: number,
    r: number, g: number, b: number, a: number, round: boolean,
  ): void
  bPolyline(n: number, w: number, r: number, g: number, b: number, a: number): void
  bPolylineFade(n: number, w: number, r: number, g: number, b: number): void
  bTerrainFill(n: number, viewB: number, r: number, g: number, b: number, a: number): void
  bTracers(count: number, w: number, headR: number): void
  bDisc(
    cx: number, cy: number, rx: number, ry: number, rot: number, seg: number,
    r: number, g: number, b: number, a: number,
  ): void
  bDiscGrad(
    cx: number, cy: number, radius: number, seg: number,
    cr: number, cg: number, cb: number, ca: number,
    er: number, eg: number, eb: number, ea: number,
  ): void
  bDiscGradCore(
    cx: number, cy: number, radius: number, seg: number, solidFrac: number,
    cr: number, cg: number, cb: number, ca: number,
    er: number, eg: number, eb: number, ea: number,
  ): void
  bRing(
    cx: number, cy: number, rx: number, ry: number, rot: number, seg: number, w: number,
    r: number, g: number, b: number, a: number,
  ): void
  bArc(
    cx: number, cy: number, radius: number, a0: number, a1: number, seg: number, w: number,
    r: number, g: number, b: number, a: number,
  ): void
  bDashRing(
    cx: number, cy: number, radius: number, on: number, off: number, w: number,
    r: number, g: number, b: number, a: number,
  ): void
}

export interface EngineExports extends FluidExports, BatchExports {
  memory: WebAssembly.Memory
}

// 单实例句柄：fluid/batch 门面共享 ex、ambient 与 origin（物理 setAmbient/create 写、渲染零拷贝采样读）。
// origin = 地图在流体网格内的原点偏移（格）：流体域 = 地图外扩边距
export interface EngineHandle {
  readonly ex: EngineExports
  readonly memory: WebAssembly.Memory
  readonly ambient: { x: number; y: number }
  readonly origin: { x: number; y: number }
}

let wasmModule: WebAssembly.Module | null = null

export function initEngine(bytes: ArrayBuffer | Uint8Array): boolean {
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

// 平台无关引导：调用方按运行环境提供取字节实现（浏览器 fetch 资源 / node-bun 读文件）；
// SIMD 探测失败或加载失败一律返回 false，绝不抛
export async function bootEngine(load: () => Promise<ArrayBuffer | Uint8Array>): Promise<boolean> {
  if (typeof WebAssembly === 'undefined' || !simdAvailable()) return false
  try {
    return initEngine(await load())
  } catch {
    return false
  }
}

// 每实例独立内存（测试隔离）；实例化失败即抛错——绝无静默回退
export function createEngine(): EngineHandle {
  if (!wasmModule) throw new Error('WASM 引擎未加载')
  try {
    const inst = new WebAssembly.Instance(wasmModule, {
      env: {
        abort(_msg: number, _file: number, line: number, col: number) {
          throw new Error(`WASM 内核异常（行 ${line}:${col}）`)
        },
      },
    })
    const ex = inst.exports as unknown as EngineExports
    return { ex, memory: ex.memory, ambient: { x: 0, y: 0 }, origin: { x: 0, y: 0 } }
  } catch {
    throw new Error('WASM 引擎实例化失败')
  }
}
