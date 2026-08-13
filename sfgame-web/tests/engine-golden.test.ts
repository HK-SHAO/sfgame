// 物理位稳定性回归（golden hash）：内核数值输出钉死在迁移基线（assembly→Moonbit 迁移时
// 经双引擎逐位对拍验证后固化）。混沌流场下任何浮点结合律/舍入漂移都会改变这些哈希——
// 物理位型变化会使已录通关最佳时间的可复现性失效，故必须响亮失败，人工确认后才可更新基线
import { expect, test } from 'vitest'
import { bakeTerrain } from '../app/sim/terrain.ts'
import { createEngine, type EngineHandle } from '../app/wasm/engine.ts'

function fnv(bytes: Uint8Array): string {
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function f32Hash(h: EngineHandle, ptr: number, n: number): string {
  return fnv(new Uint8Array(h.memory.buffer, ptr, n * 4))
}

function hashDoubles(vals: number[]): string {
  const b = new ArrayBuffer(vals.length * 8)
  const dv = new DataView(b)
  vals.forEach((v, i) => dv.setFloat64(i * 8, v, true))
  return fnv(new Uint8Array(b))
}

const DT = 1 / 60

interface FluidScenario {
  nx: number
  ny: number
  margin: number
  sdf: (x: number, y: number) => number
  ambient: [number, number, number]
  drive(e: EngineHandle, dt: number): void
  probes: [number, number][]
  golden: { u: string; v: string; t: string; fx: string; probes: string }
}

const FLUID_SCENARIOS: [string, FluidScenario][] = [
  ['热源羽流（平地、无边距）', {
    nx: 48, ny: 36, margin: 0,
    sdf: (_x, y) => 45 - y,
    ambient: [0, 0, 0],
    drive: (e, dt) => {
      for (let i = 0; i < 3; i++) e.ex.addHeat(36, 38, 16 * dt)
    },
    probes: [[36, 32], [20, 20], [50, 10], [5, 40]],
    golden: { u: '1d6b84c5', v: 'b493da89', t: '603c821b', fx: 'fc27d7d542d919c5', probes: 'f442e739' },
  }],
  ['冷源 + 环境风 + 温度偏置', {
    nx: 48, ny: 36, margin: 0,
    sdf: (_x, y) => 45 - y,
    ambient: [0.3, -0.2, 1.5],
    drive: (e, dt) => {
      e.ex.addHeat(36, 20, -16 * dt)
    },
    probes: [[36, 26], [10, 30], [60, 42], [24, 5]],
    golden: { u: 'a10033b3', v: 'f19a6127', t: 'df787aa2', fx: 'fc27d7d542d919c5', probes: '71cc21dd' },
  }],
  ['风扇注入 + 边距 sponge', {
    nx: 48, ny: 36, margin: 4,
    sdf: (_x, y) => 42 - y,
    ambient: [0.15, 0, 0],
    drive: (e) => {
      e.ex.addForce(30, 30, 1, -0.3, 0.9, 3.2)
    },
    probes: [[30, 30], [8, 24], [52, 40], [2, 2]],
    golden: { u: 'b4a1218f', v: '9569f331', t: '42d919c5', fx: '6d3fca7542d919c5', probes: 'f8062f79' },
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
    golden: { u: 'f5a049d2', v: 'e672fbb5', t: 'f54614a4', fx: '6011dd835a3b60ab', probes: '67bd0c97' },
  }],
]

for (const [name, sc] of FLUID_SCENARIOS) {
  test(`流体 golden：${name}`, () => {
    const h = createEngine()
    const cell = 1.5
    expect(h.ex.init(sc.nx, sc.ny, cell, 2.0, 9, 18, 3.4, 0.996, 0.99, 12, sc.margin)).toBe(0)
    const terrain = bakeTerrain(sc.sdf, { w: (sc.nx - 2 * sc.margin) * cell, h: (sc.ny - sc.margin) * cell }, cell, sc.margin * cell)
    expect(terrain.nx).toBe(sc.nx)
    expect(terrain.ny).toBe(sc.ny)
    new Uint8Array(h.memory.buffer, h.ex.solidBuf(), sc.nx * sc.ny).set(terrain.mask)
    h.ex.rebuildSolid()
    expect(
      f32Hash(h, h.ex.fieldFxU(), sc.nx * sc.ny) + f32Hash(h, h.ex.fieldFxV(), sc.nx * sc.ny),
      '环境位流基场 fxU/fxV',
    ).toBe(sc.golden.fx)
    h.ex.setAmbient(sc.ambient[0], sc.ambient[1], sc.ambient[2])
    for (let i = 0; i < 120; i++) {
      sc.drive(h, DT)
      h.ex.step(DT)
    }
    const n = sc.nx * sc.ny
    expect(f32Hash(h, h.ex.fieldU(), n), 'u 场').toBe(sc.golden.u)
    expect(f32Hash(h, h.ex.fieldV(), n), 'v 场').toBe(sc.golden.v)
    expect(f32Hash(h, h.ex.fieldT(), n), 't 场').toBe(sc.golden.t)
    const probes: number[] = []
    for (const [px, py] of sc.probes) {
      h.ex.sampleVelocity(px, py)
      probes.push(h.ex.outX(), h.ex.outY(), h.ex.sampleTemp(px, py))
    }
    expect(hashDoubles(probes), '采样探针').toBe(sc.golden.probes)
  })
}

test('顶点批 golden：图元/地形/示踪三场景', () => {
  // 混合图元场景
  {
    const h = createEngine()
    const ex = h.ex
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
    expect(ex.bCount()).toBe(1545)
    expect(f32Hash(h, ex.bData(), ex.bCount() * 6), '混合场景顶点').toBe('e038f6ec')
  }
  // 地形 marching squares
  {
    const h = createEngine()
    const ex = h.ex
    const nx = 24
    const ny = 18
    const cell = 2.0
    expect(ex.bTerrainField(nx, ny, 0, 0, cell, 0.55, 0.45, 0.3, 0.2, 0.16, 0.12, 8)).toBe(0)
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
    expect(terrainCount).toBe(1302)
    expect(f32Hash(h, ex.bTerrainData(), terrainCount * 6), '地形顶点').toBe('3450fc3b')
  }
  // 示踪批量 tessellate
  {
    const h = createEngine()
    const ex = h.ex
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
    expect(ex.bCount()).toBe(720)
    expect(f32Hash(h, ex.bData(), ex.bCount() * 6), '示踪顶点').toBe('697bc98f')
  }
})

test('示踪粒子 golden：同种子全状态演化', () => {
  const h = createEngine()
  const ex = h.ex
  expect(ex.init(48, 36, 1.5, 2.0, 9, 18, 3.4, 0.996, 0.99, 12, 0)).toBe(0)
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
  expect(ex.tracersInit(400, 24, 72, 54, 0, 48, 36, 1.5, 0, 0, 0x9e3779b9)).toBe(0)
  expect(f32Hash(h, ex.tXBuf(), 400), 'init x').toBe('c352a93c')
  expect(f32Hash(h, ex.tYBuf(), 400), 'init y').toBe('c0b2db93')
  expect(f32Hash(h, ex.tLifeBuf(), 400), 'init life').toBe('7e1a20a0')
  for (let i = 0; i < 240; i++) ex.tracersStep(DT, 2)
  expect(f32Hash(h, ex.tXBuf(), 400), '240 步 x').toBe('10d33e1a')
  expect(f32Hash(h, ex.tYBuf(), 400), '240 步 y').toBe('c5f6b699')
  expect(f32Hash(h, ex.tLifeBuf(), 400), '240 步 life').toBe('62690711')
  expect(f32Hash(h, ex.tMaxLifeBuf(), 400), '240 步 maxLife').toBe('9005fc3c')
  expect(f32Hash(h, ex.tTrailXBuf(), 9600), '240 步 trailX').toBe('44aa74c9')
  expect(f32Hash(h, ex.tTrailYBuf(), 9600), '240 步 trailY').toBe('a0e104aa')
  expect(f32Hash(h, ex.tTrailTBuf(), 9600), '240 步 trailT').toBe('9b0eda03')
  expect(fnv(new Uint8Array(h.memory.buffer, ex.tTrailNBuf(), 400)), '240 步 trailN').toBe('85d6e97b')
  expect(hashDoubles([ex.tTime()]), '240 步 time').toBe('56db1d74')
})
