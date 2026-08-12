// Moonbit 顶点批内核 vs assembly 内核对拍：同图元序列 → 顶点数严格一致、顶点数值一致。
// 渲染几何非混沌路径；三角函数走各自标准库 libm，允许最低位差异，用容差比较（见 EPS）。
// 顶点数、容量、缓冲布局（宿主 WebGL 上传契约）必须逐位一致
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { createEngine } from '../app/wasm/engine.ts'

interface BatchFace {
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
  bTri(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, r: number, g: number, b: number, a: number): void
  bRect(x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, a: number): void
  bRectVGrad(x0: number, y0: number, x1: number, y1: number, r0: number, g0: number, b0: number, a0: number, r1: number, g1: number, b1: number, a1: number): void
  bStroke(x0: number, y0: number, x1: number, y1: number, w: number, r: number, g: number, b: number, a: number, round: boolean): void
  bPolylineFade(n: number, w: number, r: number, g: number, b: number): void
  bTerrainFieldBuf(): number
  bTerrainFieldCap(): number
  bTerrainField(nx: number, ny: number, x0: number, y0: number, cell: number, sr: number, sg: number, sb: number, dr: number, dg: number, db: number, depthLen: number): number
  bTerrainDraw(i0: number, j0: number, i1: number, j1: number): void
  bTracers(count: number, w: number, headR: number): void
  bDisc(cx: number, cy: number, rx: number, ry: number, rot: number, seg: number, r: number, g: number, b: number, a: number): void
  bDiscGrad(cx: number, cy: number, radius: number, seg: number, cr: number, cg: number, cb: number, ca: number, er: number, eg: number, eb: number, ea: number): void
  bRing(cx: number, cy: number, rx: number, ry: number, rot: number, seg: number, w: number, r: number, g: number, b: number, a: number): void
  bArc(cx: number, cy: number, radius: number, a0: number, a1: number, seg: number, w: number, r: number, g: number, b: number, a: number): void
  bDashRing(cx: number, cy: number, radius: number, on: number, off: number, w: number, r: number, g: number, b: number, a: number): void
}

interface Engine {
  ex: BatchFace
  memory: WebAssembly.Memory
}

function bootAs(): Engine {
  const h = createEngine()
  return { ex: h.ex as unknown as BatchFace, memory: h.memory }
}

function bootMbt(): Engine {
  const p = fileURLToPath(new URL('../app/wasm/sfengine.mbt.wasm', import.meta.url))
  const inst = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(p)), {})
  return { ex: inst.exports as unknown as BatchFace, memory: inst.exports.memory as WebAssembly.Memory }
}

const STRIDE = 6
// libm 最低位容差：cos/sin/atan2/exp 实现差异导致，远低于渲染可见阈值
const EPS = 1e-5

function drawScene(e: Engine) {
  const f = e.ex
  f.bReset()
  f.bTri(0, 0, 10, 0, 5, 8, 1, 0.2, 0.3, 0.8)
  f.bRect(2, 3, 12, 9, 0.1, 0.9, 0.5, 1)
  f.bRectVGrad(0, 0, 20, 10, 1, 1, 1, 1, 0.2, 0.3, 0.9, 0.5)
  f.bDisc(15, 15, 6, 4, 0.7, 24, 0.9, 0.8, 0.1, 0.9)
  f.bDiscGrad(30, 20, 8, 20, 1, 1, 0.6, 1, 1, 0.4, 0.2, 0)
  f.bStroke(0, 0, 25, 12, 2.5, 0.2, 0.2, 0.8, 1, true)
  f.bStroke(5, 20, 5, 40, 1.5, 0.8, 0.1, 0.1, 1, false)
  f.bRing(40, 30, 7, 5, 0.3, 28, 1.8, 0.1, 0.7, 0.4, 0.85)
  f.bArc(50, 10, 9, 0.5, 4.2, 16, 2.2, 0.9, 0.9, 0.2, 0.7)
  f.bDashRing(60, 40, 11, 3, 2, 1.6, 0.3, 0.6, 0.9, 0.95)
  // 折线（宿主先写 pts/fade 缓冲）
  const pts = new Float32Array(e.memory.buffer, f.bPtsBuf(), f.bPtsCap())
  const fade = new Float32Array(e.memory.buffer, f.bFadeBuf(), f.bFadeCap())
  const nPts = 8
  for (let i = 0; i < nPts; i++) {
    pts[i * 2] = 5 + i * 4
    pts[i * 2 + 1] = 30 + Math.sin(i * 0.9) * 6
    fade[i] = 1 - i / nPts
  }
  f.bPolylineFade(nPts * 2, 2.0, 0.5, 0.9, 0.3)
}

function vertices(e: Engine): Float32Array {
  const n = e.ex.bCount() * STRIDE
  return new Float32Array(e.memory.buffer, e.ex.bData(), n)
}

test('顶点批：同图元序列 → 顶点数一致 + 数值容差一致', () => {
  const as = bootAs()
  const mbt = bootMbt()
  drawScene(as)
  drawScene(mbt)
  expect(mbt.ex.bCount()).toBe(as.ex.bCount())
  const va = vertices(as)
  const vm = vertices(mbt)
  expect(vm.length).toBe(va.length)
  let maxDiff = 0
  for (let i = 0; i < va.length; i++) {
    const d = Math.abs(va[i] - vm[i])
    if (d > maxDiff) maxDiff = d
    expect(d, `vertex[${i}]`).toBeLessThan(EPS)
  }
  console.log(`    [batch-parity] 顶点数=${as.ex.bCount()} 最大偏差=${maxDiff.toExponential(2)}`)
})

test('顶点批：容量/缓冲布局契约一致', () => {
  const as = bootAs()
  const mbt = bootMbt()
  expect(mbt.ex.bCapacity()).toBe(as.ex.bCapacity())
  expect(mbt.ex.bPtsCap()).toBe(as.ex.bPtsCap())
  expect(mbt.ex.bFadeCap()).toBe(as.ex.bFadeCap())
  expect(mbt.ex.bTracerCap()).toBe(as.ex.bTracerCap())
  expect(mbt.ex.bTracerStride()).toBe(as.ex.bTracerStride())
  expect(mbt.ex.bTerrainFieldCap()).toBe(as.ex.bTerrainFieldCap())
})

test('顶点批：地形 marching squares 一致', () => {
  const as = bootAs()
  const mbt = bootMbt()
  const nx = 24
  const ny = 18
  const cell = 2.0
  for (const e of [as, mbt]) {
    const st = e.ex.bTerrainField(nx, ny, 0, 0, cell, 0.55, 0.45, 0.3, 0.2, 0.16, 0.12, 8)
    expect(st).toBe(0)
    const field = new Float32Array(e.memory.buffer, e.ex.bTerrainFieldBuf(), e.ex.bTerrainFieldCap())
    // 地形并集：地面（y≥20 固体）+ 圆形土丘（含鞍点邻接形态，触发 marching squares 全分支）
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = (i + 0.5) * cell
        const y = (j + 0.5) * cell
        const ground = 20 - y
        const cx = 24
        const cy = 16
        const circ = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) - 6
        field[j * nx + i] = Math.min(ground, circ)
      }
    }
  }
  for (const e of [as, mbt]) {
    e.ex.bReset()
    e.ex.bTerrainDraw(0, 0, nx - 1, ny - 1)
  }
  expect(mbt.ex.bCount()).toBe(as.ex.bCount())
  const va = vertices(as)
  const vm = vertices(mbt)
  let maxDiff = 0
  for (let i = 0; i < va.length; i++) {
    const d = Math.abs(va[i] - vm[i])
    if (d > maxDiff) maxDiff = d
    expect(d, `terrain vertex[${i}]`).toBeLessThan(EPS)
  }
  console.log(`    [batch-parity] 地形顶点数=${as.ex.bCount()} 最大偏差=${maxDiff.toExponential(2)}`)
})

test('顶点批：示踪粒子批量 tessellate 一致', () => {
  const as = bootAs()
  const mbt = bootMbt()
  const cap = as.ex.bTracerCap()
  const stride = as.ex.bTracerStride()
  for (const e of [as, mbt]) {
    const buf = new Float32Array(e.memory.buffer, e.ex.bTracerBuf(), cap * stride)
    for (let i = 0; i < 12; i++) {
      const off = i * stride
      buf[off] = 0.4 + i * 0.04 // r
      buf[off + 1] = 0.7 // g
      buf[off + 2] = 0.9 // b
      buf[off + 3] = 6 // np
      buf[off + 4] = 0.8 // headA
      for (let k = 0; k < 6; k++) {
        buf[off + 5 + k * 3] = 10 + i * 5 + k * 0.45 // x
        buf[off + 6 + k * 3] = 20 + Math.sin(k + i) * 3 // y
        buf[off + 7 + k * 3] = k / 6 // fade
      }
    }
  }
  for (const e of [as, mbt]) {
    e.ex.bReset()
    e.ex.bTracers(12, 1.6, 1.1)
  }
  expect(mbt.ex.bCount()).toBe(as.ex.bCount())
  const va = vertices(as)
  const vm = vertices(mbt)
  let maxDiff = 0
  for (let i = 0; i < va.length; i++) {
    const d = Math.abs(va[i] - vm[i])
    if (d > maxDiff) maxDiff = d
    expect(d, `tracer vertex[${i}]`).toBeLessThan(EPS)
  }
  console.log(`    [batch-parity] 示踪顶点数=${as.ex.bCount()} 最大偏差=${maxDiff.toExponential(2)}`)
})

test('顶点批：容量溢出优雅丢弃（不越界）', () => {
  for (const e of [bootAs(), bootMbt()]) {
    const f = e.ex
    f.bReset()
    const cap = f.bCapacity()
    const tris = Math.floor(cap / 3) + 10
    for (let i = 0; i < tris; i++) {
      f.bTri(0, 0, 1, 0, 0, 1, 1, 1, 1, 1)
    }
    expect(f.bCount()).toBeLessThanOrEqual(cap)
    expect(f.bCount() % 3).toBe(0)
  }
})
