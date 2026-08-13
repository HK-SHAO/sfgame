// WASM 引擎引导与实例化（moon/ 数值内核 → sfengine.wasm）：流体 + 顶点批 + 示踪内核同一实例共享内存。
// 内存静态定型（运行期零分配），视图生命周期内恒定，可安全缓存。
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
    marginCells: number,
  ): number
  clear(): void
  setAmbient(x: number, y: number, temp: number): void
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
  // 网格容量（编译期钉死上限，grid-limits.ts 镜像）：schema/运行时校验与内核同源
  fMaxNx(): number
  fMaxNy(): number
}

export interface BatchExports {
  bCapacity(): number
  bPtsCap(): number
  bFadeCap(): number
  bTracerCap(): number
  bTracerStride(): number
  bVertexStride(): number
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
  bPolylineFade(n: number, w: number, r: number, g: number, b: number): void
  bTerrainFieldBuf(): number
  bTerrainFieldCap(): number
  bTerrainField(
    nx: number, ny: number, x0: number, y0: number, cell: number,
    sr: number, sg: number, sb: number, dr: number, dg: number, db: number, depthLen: number,
  ): number
  bTerrainDraw(i0: number, j0: number, i1: number, j1: number): number
  bTerrainData(): number
  bTerrainCap(): number
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

export interface TracerExports {
  tracersInit(
    count: number, trailLen: number, worldW: number, worldH: number, margin: number,
    snx: number, sny: number, scell: number, sox: number, soy: number, seed: number,
  ): number
  tracersStep(dt: number, srcCount: number): void
  tTime(): number
  tXBuf(): number
  tYBuf(): number
  tLifeBuf(): number
  tMaxLifeBuf(): number
  tTrailXBuf(): number
  tTrailYBuf(): number
  tTrailTBuf(): number
  tTrailNBuf(): number
  tSdfBuf(): number
  tSdfCap(): number
  tSrcBuf(): number
  tSrcCap(): number
}

export interface EngineExports extends FluidExports, BatchExports, TracerExports {
  memory: WebAssembly.Memory
}

// 单实例句柄：fluid/batch 门面共享 ex、ambient 与 origin（物理 setAmbient/create 写、渲染零拷贝采样读）。
// ambient.t = 环境温度偏置（浮力/着色消费时叠加）；origin = 地图在流体网格内的原点偏移（格）：流体域 = 地图外扩边距
export interface EngineHandle {
  readonly ex: EngineExports
  readonly memory: WebAssembly.Memory
  readonly ambient: { x: number; y: number; t: number }
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

// 平台无关引导：调用方按运行环境提供取字节实现（浏览器 fetch 资源 / node-bun 读文件）；
// 加载失败一律返回 false，绝不抛。内核为纯 wasm MVP 标量实现（Moonbit 编译），无 SIMD 门槛
export async function bootEngine(load: () => Promise<ArrayBuffer | Uint8Array>): Promise<boolean> {
  if (typeof WebAssembly === 'undefined') return false
  try {
    return initEngine(await load())
  } catch {
    return false
  }
}

// 每实例独立内存（测试隔离）；实例化失败即抛错——绝无静默回退。
// 内核零 import（foreign_library），无需宿主提供环境函数
export function createEngine(): EngineHandle {
  if (!wasmModule) throw new Error('WASM 引擎未加载')
  try {
    const inst = new WebAssembly.Instance(wasmModule, {})
    const ex = inst.exports as unknown as EngineExports
    return { ex, memory: ex.memory, ambient: { x: 0, y: 0, t: 0 }, origin: { x: 0, y: 0 } }
  } catch {
    throw new Error('WASM 引擎实例化失败')
  }
}
