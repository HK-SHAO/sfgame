// golden 计算核心（engine-golden.test.ts 与 scripts/print-golden.ts 共用单一事实源）：
// 场景定义 + 哈希原语 + 期望值。改物理后先人工确认，再用 print-golden 打印新值回填 golden 字段
import { bakeTerrain } from '../app/sim/terrain.ts'
import { createEngine, type EngineHandle } from '../app/wasm/engine.ts'

export function fnv(bytes: Uint8Array): string {
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function f32Hash(h: EngineHandle, ptr: number, n: number): string {
  return fnv(new Uint8Array(h.memory.buffer, ptr, n * 4))
}

export function hashDoubles(vals: number[]): string {
  const b = new ArrayBuffer(vals.length * 8)
  const dv = new DataView(b)
  vals.forEach((v, i) => dv.setFloat64(i * 8, v, true))
  return fnv(new Uint8Array(b))
}

export const DT = 1 / 60

export interface FluidScenario {
  nx: number
  ny: number
  margin: number
  sdf: (x: number, y: number) => number
  ambient: [number, number, number]
  drive(e: EngineHandle, dt: number): void
  probes: [number, number][]
  golden: { u: string; v: string; t: string; fx: string; probes: string }
}

export const FLUID_SCENARIOS: [string, FluidScenario][] = [
  ['热源羽流（平地、无边距）', {
    nx: 48, ny: 36, margin: 0,
    sdf: (_x, y) => 45 - y,
    ambient: [0, 0, 0],
    drive: (e, dt) => {
      for (let i = 0; i < 3; i++) e.ex.addHeat(36, 38, 16 * dt)
    },
    probes: [[36, 32], [20, 20], [50, 10], [5, 40]],
    golden: { u: '01099ab0', v: '9238dc34', t: '11a53755', fx: 'fc27d7d542d919c5', probes: 'be13e19e' },
  }],
  ['冷源 + 环境风 + 温度偏置', {
    nx: 48, ny: 36, margin: 0,
    sdf: (_x, y) => 45 - y,
    ambient: [0.3, -0.2, 1.5],
    drive: (e, dt) => {
      e.ex.addHeat(36, 20, -16 * dt)
    },
    probes: [[36, 26], [10, 30], [60, 42], [24, 5]],
    golden: { u: 'bf2b58cd', v: 'd3db4776', t: 'e17c711c', fx: 'fc27d7d542d919c5', probes: '0b77afbc' },
  }],
  ['风扇注入 + 边距 sponge', {
    nx: 48, ny: 36, margin: 4,
    sdf: (_x, y) => 42 - y,
    ambient: [0.15, 0, 0],
    drive: (e) => {
      e.ex.addForce(30, 30, 1, -0.3, 0.9, 3.2)
    },
    probes: [[30, 30], [8, 24], [52, 40], [2, 2]],
    golden: { u: '67158994', v: '3da9b7b2', t: '42d919c5', fx: '6d3fca7542d919c5', probes: '5f975249' },
  }],
  ['坡地固体 + 奇数 nx', {
    nx: 47, ny: 36, margin: 0,
    sdf: (x, y) => 40 - y + x * 0.25,
    ambient: [0.25, 0, 0.8],
    drive: (e, dt) => {
      e.ex.addHeat(20, 30, 14 * dt)
      e.ex.addHeat(50, 26, -10 * dt)
    },
    probes: [[20, 24], [50, 20], [35, 12], [6, 33]],
    golden: { u: 'fa09e9f0', v: '3bf64859', t: '8125d243', fx: '6011dd835a3b60ab', probes: '22c131ff' },
  }],
]

// 期望值（测试断言用；print-golden 只打印计算值供人工比对）
export interface BatchGolden {
  mix: { count: number; hash: string }
  terrain: { count: number; hash: string }
  tracers: { count: number; hash: string }
}

export const BATCH_GOLDEN: BatchGolden = {
  mix: { count: 1545, hash: 'e038f6ec' },
  terrain: { count: 1302, hash: '3450fc3b' },
  tracers: { count: 720, hash: '697bc98f' },
}

export const TRACER_GOLDEN = {
  init: { x: 'c352a93c', y: 'c0b2db93', life: '7e1a20a0' },
  after240: {
    // 2026-08-14 重基线：触地/出界死亡路径归一（就地淡出替代即时重生）——行为有意变更
    x: '80dd3721', y: 'fb2e147f', life: '22ae2c31', maxLife: '61f04489',
    trailX: '9011b718', trailY: 'f9680000', trailT: 'b10403f5', trailN: '74db9626',
  },
  time: '56db1d74',
}

export function runFluidGolden(name: string, sc: FluidScenario): { u: string; v: string; t: string; fx: string; probes: string } {
  void name
  const h = createEngine()
  const cell = 1.5
  if (h.ex.init(sc.nx, sc.ny, cell, 2.0, 9, 3.4, 0.996, 0.99, 12, sc.margin) !== 0) {
    throw new Error(`init 失败：${sc.nx}×${sc.ny}`)
  }
  const terrain = bakeTerrain(sc.sdf, { w: (sc.nx - 2 * sc.margin) * cell, h: (sc.ny - sc.margin) * cell }, cell, sc.margin * cell)
  if (terrain.nx !== sc.nx || terrain.ny !== sc.ny) throw new Error('烘焙尺寸不符')
  new Uint8Array(h.memory.buffer, h.ex.solidBuf(), sc.nx * sc.ny).set(terrain.mask)
  h.ex.rebuildSolid()
  const fx = f32Hash(h, h.ex.fieldFxU(), sc.nx * sc.ny) + f32Hash(h, h.ex.fieldFxV(), sc.nx * sc.ny)
  h.ex.setAmbient(sc.ambient[0], sc.ambient[1], sc.ambient[2])
  for (let i = 0; i < 120; i++) {
    sc.drive(h, DT)
    h.ex.step(DT)
  }
  const n = sc.nx * sc.ny
  const probes: number[] = []
  for (const [px, py] of sc.probes) {
    h.ex.sampleVelocity(px, py)
    probes.push(h.ex.outX(), h.ex.outY(), h.ex.sampleTemp(px, py))
  }
  return { u: f32Hash(h, h.ex.fieldU(), n), v: f32Hash(h, h.ex.fieldV(), n), t: f32Hash(h, h.ex.fieldT(), n), fx, probes: hashDoubles(probes) }
}

export function runBatchGolden(): BatchGolden {
  // 混合图元场景
  let h = createEngine()
  let ex = h.ex
  ex.bReset()
  ex.bTri(0, 0, 10, 0, 5, 8, 1, 0.2, 0.3, 0.8)
  ex.bRect(2, 3, 12, 9, 0.1, 0.9, 0.5, 1)
  ex.bRectVGrad(0, 0, 20, 10, 1, 1, 1, 1, 0.2, 0.3, 0.9, 0.5)
  ex.bDisc(15, 15, 6, 4, 0.7, 24, 0.9, 0.8, 0.1, 0.9)
  ex.bDiscGrad(30, 20, 8, 20, 1, 1, 0.6, 1, 1, 0.4, 0.2, 0)
  ex.bStroke(0, 0, 25, 12, 2.5, 0.2, 0.2, 0.8, 1, true)
  ex.bStroke(5, 20, 5, 40, 1.5, 0.8, 0.1, 0.1, 1, false)
  ex.bRing(40, 30, 7, 5, 0.3, 28, 1.8, 0.1, 0.7, 0.4, 0.85)
  ex.bArc(50, 10, 9, 0.5, 4.2, 16, 2.2, 0.9, 0.9, 0.2, 0.7)
  ex.bDashRing(60, 40, 11, 3, 2, 1.6, 0.3, 0.6, 0.9, 0.95)
  const pts = new Float32Array(h.memory.buffer, ex.bPtsBuf(), ex.bPtsCap())
  const fade = new Float32Array(h.memory.buffer, ex.bFadeBuf(), ex.bFadeCap())
  for (let i = 0; i < 8; i++) {
    pts[i * 2] = 5 + i * 4
    pts[i * 2 + 1] = 30 + Math.sin(i * 0.9) * 6
    fade[i] = 1 - i / 8
  }
  ex.bPolylineFade(16, 2.0, 0.5, 0.9, 0.3)
  const mixCount = ex.bCount()
  const mixHash = f32Hash(h, ex.bData(), mixCount * 6)

  // 地形 marching squares
  h = createEngine()
  ex = h.ex
  const nx = 24
  const ny = 18
  const cell = 2.0
  if (ex.bTerrainField(nx, ny, 0, 0, cell, 0.55, 0.45, 0.3, 0.2, 0.16, 0.12, 8) !== 0) throw new Error('terrainField 失败')
  const field = new Float32Array(h.memory.buffer, ex.bTerrainFieldBuf(), ex.bTerrainFieldCap())
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = (i + 0.5) * cell
      const y = (j + 0.5) * cell
      field[j * nx + i] = Math.min(20 - y, Math.sqrt((x - 24) ** 2 + (y - 16) ** 2) - 6)
    }
  }
  ex.bReset()
  const terrainCount = ex.bTerrainDraw(0, 0, nx - 1, ny - 1)
  const terrainHash = f32Hash(h, ex.bTerrainData(), terrainCount * 6)

  // 示踪批量 tessellate
  h = createEngine()
  ex = h.ex
  const buf = new Float32Array(h.memory.buffer, ex.bTracerBuf(), ex.bTracerCap() * ex.bTracerStride())
  for (let i = 0; i < 12; i++) {
    const off = i * ex.bTracerStride()
    buf[off] = 0.4 + i * 0.04
    buf[off + 1] = 0.7
    buf[off + 2] = 0.9
    buf[off + 3] = 6
    buf[off + 4] = 0.8
    for (let k = 0; k < 6; k++) {
      buf[off + 5 + k * 3] = 10 + i * 5 + k * 0.45
      buf[off + 6 + k * 3] = 20 + Math.sin(k + i) * 3
      buf[off + 7 + k * 3] = k / 6
    }
  }
  ex.bReset()
  ex.bTracers(12, 1.6, 1.1)
  const tracerCount = ex.bCount()
  const tracerHash = f32Hash(h, ex.bData(), tracerCount * 6)

  return {
    mix: { count: mixCount, hash: mixHash },
    terrain: { count: terrainCount, hash: terrainHash },
    tracers: { count: tracerCount, hash: tracerHash },
  }
}

export function runTracerGolden(): {
  init: { x: string; y: string; life: string }
  after240: { x: string; y: string; life: string; maxLife: string; trailX: string; trailY: string; trailT: string; trailN: string }
  time: string
} {
  const h = createEngine()
  const ex = h.ex
  if (ex.init(48, 36, 1.5, 2.0, 9, 3.4, 0.996, 0.99, 12, 0) !== 0) throw new Error('init 失败')
  const terrain = bakeTerrain((_x, y) => 45 - y, { w: 72, h: 54 }, 1.5, 0)
  new Uint8Array(h.memory.buffer, ex.solidBuf(), 48 * 36).set(terrain.mask)
  ex.rebuildSolid()
  ex.setAmbient(0.5, 0, 0)
  new Float32Array(h.memory.buffer, ex.tSdfBuf(), ex.tSdfCap()).set(terrain.field)
  const src = new Float32Array(h.memory.buffer, ex.tSrcBuf(), ex.tSrcCap() * 2)
  src[0] = 30
  src[1] = 36
  src[2] = 50
  src[3] = 30
  if (ex.tracersInit(400, 24, 72, 54, 0, 48, 36, 1.5, 0, 0, 0x9e3779b9) !== 0) throw new Error('tracersInit 失败')
  const init = { x: f32Hash(h, ex.tXBuf(), 400), y: f32Hash(h, ex.tYBuf(), 400), life: f32Hash(h, ex.tLifeBuf(), 400) }
  for (let i = 0; i < 240; i++) ex.tracersStep(DT, 2)
  return {
    init,
    after240: {
      x: f32Hash(h, ex.tXBuf(), 400),
      y: f32Hash(h, ex.tYBuf(), 400),
      life: f32Hash(h, ex.tLifeBuf(), 400),
      maxLife: f32Hash(h, ex.tMaxLifeBuf(), 400),
      trailX: f32Hash(h, ex.tTrailXBuf(), 9600),
      trailY: f32Hash(h, ex.tTrailYBuf(), 9600),
      trailT: f32Hash(h, ex.tTrailTBuf(), 9600),
      trailN: fnv(new Uint8Array(h.memory.buffer, ex.tTrailNBuf(), 400)),
    },
    time: hashDoubles([ex.tTime()]),
  }
}
