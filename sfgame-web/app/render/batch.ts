// 顶点批：数值内核在 assembly/batch.ts（WASM，经 app/wasm/engine.ts 单实例加载），此处仅包装。
// 顶点格式 x,y,r,g,b,a（0..1 非预乘）平铺；逐顶点颜色 → 整帧一次 draw call、精确逐图元透明度
import { createEngine, type EngineHandle } from '../wasm/engine'

export const VERTEX_STRIDE = 6

// 内存静态定型（零运行期分配），视图生命周期内恒定，可安全缓存
export class MeshBatch {
  private ex: EngineHandle['ex']
  private view: Float32Array
  private ptsView: Float32Array
  private fadeView: Float32Array
  private tracerView: Float32Array
  private terrainFieldView: Float32Array

  constructor(engine = createEngine()) {
    const ex = engine.ex
    this.ex = ex
    const buf = engine.memory.buffer
    this.view = new Float32Array(buf, ex.bData(), ex.bCapacity() * VERTEX_STRIDE)
    this.ptsView = new Float32Array(buf, ex.bPtsBuf(), ex.bPtsCap())
    this.fadeView = new Float32Array(buf, ex.bFadeBuf(), ex.bFadeCap())
    this.tracerView = new Float32Array(buf, ex.bTracerBuf(), ex.bTracerCap() * ex.bTracerStride())
    this.terrainFieldView = new Float32Array(buf, ex.bTerrainFieldBuf(), ex.bTerrainFieldCap())
  }

  get data(): Float32Array {
    return this.view
  }

  get count(): number {
    return this.ex.bCount()
  }

  get capacity(): number {
    return this.ex.bCapacity()
  }

  reset() {
    this.ex.bReset()
  }

  tri(
    x0: number, y0: number,
    x1: number, y1: number,
    x2: number, y2: number,
    r: number, g: number, b: number, a: number,
  ) {
    this.ex.bTri(x0, y0, x1, y1, x2, y2, r, g, b, a)
  }

  rect(x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, a: number) {
    this.ex.bRect(x0, y0, x1, y1, r, g, b, a)
  }

  rectVGrad(
    x0: number, y0: number, x1: number, y1: number,
    r0: number, g0: number, b0: number, a0: number,
    r1: number, g1: number, b1: number, a1: number,
  ) {
    this.ex.bRectVGrad(x0, y0, x1, y1, r0, g0, b0, a0, r1, g1, b1, a1)
  }

  stroke(
    x0: number, y0: number, x1: number, y1: number, w: number,
    r: number, g: number, b: number, a: number, round = false,
  ) {
    this.ex.bStroke(x0, y0, x1, y1, w, r, g, b, a, round)
  }

  // pts/fade 先拷入内核暂存区再 tessellate：跨边界只传指针与标量
  polyline(pts: Float32Array, n: number, w: number, r: number, g: number, b: number, a: number) {
    this.ptsView.set(pts.subarray(0, n))
    this.ex.bPolyline(n, w, r, g, b, a)
  }

  polylineFade(pts: Float32Array, n: number, w: number, r: number, g: number, b: number, alpha: Float32Array) {
    this.ptsView.set(pts.subarray(0, n))
    this.fadeView.set(alpha.subarray(0, n / 2))
    this.ex.bPolylineFade(n, w, r, g, b)
  }

  // 地形固体填充：每关写入格心 SDF 场与网格参数/配色，每帧按视域单调用 marching squares
  get terrainField(): Float32Array {
    return this.terrainFieldView
  }

  // 容量/参数非法返回 false（宿主场超限 = 编译期容量不足，不得静默）
  terrainSetup(
    nx: number, ny: number, x0: number, y0: number, cell: number,
    sr: number, sg: number, sb: number, dr: number, dg: number, db: number, depthLen: number,
  ): boolean {
    return this.ex.bTerrainField(nx, ny, x0, y0, cell, sr, sg, sb, dr, dg, db, depthLen) === 0
  }

  terrainDraw(i0: number, j0: number, i1: number, j1: number) {
    this.ex.bTerrainDraw(i0, j0, i1, j1)
  }

  // 示踪粒子批量缓冲：宿主直写定长记录（见 assembly/batch.ts 布局）后 tracers() 单调用 tessellate
  get tracerData(): Float32Array {
    return this.tracerView
  }

  get tracerStride(): number {
    return this.ex.bTracerStride()
  }

  get tracerCap(): number {
    return this.ex.bTracerCap()
  }

  tracers(count: number, w: number, headR: number) {
    this.ex.bTracers(count, w, headR)
  }

  disc(
    cx: number, cy: number, rx: number, ry: number, rot: number, seg: number,
    r: number, g: number, b: number, a: number,
  ) {
    this.ex.bDisc(cx, cy, rx, ry, rot, seg, r, g, b, a)
  }

  discGrad(
    cx: number, cy: number, radius: number, seg: number,
    cr: number, cg: number, cb: number, ca: number,
    er: number, eg: number, eb: number, ea: number,
  ) {
    this.ex.bDiscGrad(cx, cy, radius, seg, cr, cg, cb, ca, er, eg, eb, ea)
  }

  discGradCore(
    cx: number, cy: number, radius: number, seg: number, solidFrac: number,
    cr: number, cg: number, cb: number, ca: number,
    er: number, eg: number, eb: number, ea: number,
  ) {
    this.ex.bDiscGradCore(cx, cy, radius, seg, solidFrac, cr, cg, cb, ca, er, eg, eb, ea)
  }

  ring(
    cx: number, cy: number, rx: number, ry: number, rot: number, seg: number, w: number,
    r: number, g: number, b: number, a: number,
  ) {
    this.ex.bRing(cx, cy, rx, ry, rot, seg, w, r, g, b, a)
  }

  arc(
    cx: number, cy: number, radius: number, a0: number, a1: number, seg: number, w: number,
    r: number, g: number, b: number, a: number,
  ) {
    this.ex.bArc(cx, cy, radius, a0, a1, seg, w, r, g, b, a)
  }

  dashRing(
    cx: number, cy: number, radius: number, on: number, off: number, w: number,
    r: number, g: number, b: number, a: number,
  ) {
    this.ex.bDashRing(cx, cy, radius, on, off, w, r, g, b, a)
  }
}
