// Moonbit 示踪粒子内核 vs assembly 内核对拍：同种子/同风场/同地形 → 全状态逐位一致。
// RNG（mulberry32）位级等价已独立验证；风场逐位一致由流体对拍保证；此处验证粒子积分/拖尾/重生全链路
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { bakeTerrain } from '../app/sim/terrain.ts'
import { createEngine } from '../app/wasm/engine.ts'

interface TracerFace {
  init(nx: number, ny: number, cell: number, buoyancy: number, tMax: number, heatRate: number, sourceRadius: number, velDamping: number, tDamping: number, iterations: number, marginCells: number): number
  setAmbient(x: number, y: number, temp: number): void
  rebuildSolid(): void
  solidBuf(): number
  tracersInit(count: number, trailLen: number, worldW: number, worldH: number, margin: number, snx: number, sny: number, scell: number, sox: number, soy: number, seed: number): number
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

interface Engine {
  ex: TracerFace
  memory: WebAssembly.Memory
}

function bootAs(): Engine {
  const h = createEngine()
  return { ex: h.ex as unknown as TracerFace, memory: h.memory }
}

function bootMbt(): Engine {
  const p = fileURLToPath(new URL('../app/wasm/sfengine.mbt.wasm', import.meta.url))
  const inst = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(p)), {})
  return { ex: inst.exports as unknown as TracerFace, memory: inst.exports.memory as WebAssembly.Memory }
}

function bitsEqual(a: ArrayBufferView, b: ArrayBufferView, label: string) {
  const ua = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
  const ub = new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
  expect(ua.length, `${label} 长度`).toBe(ub.length)
  for (let i = 0; i < ua.length; i++) {
    if (ua[i] !== ub[i]) {
      throw new Error(`${label} 位级不一致 @字节${i}: as=0x${ua[i].toString(16)} mbt=0x${ub[i].toString(16)}`)
    }
  }
}

const COUNT = 400
const TRAIL_LEN = 24
const CELL = 1.5
const NX = 48
const NY = 36
const DT = 1 / 60
const SEED = 0x9e3779b9

test('示踪粒子：同种子同环境 → 全状态逐位一致', () => {
  const as = bootAs()
  const mbt = bootMbt()
  const terrain = bakeTerrain((_x, y) => 45 - y, { w: NX * CELL, h: NY * CELL }, CELL, 0)
  expect(terrain.nx).toBe(NX)

  for (const e of [as, mbt]) {
    expect(e.ex.init(NX, NY, CELL, 2.0, 9, 18, 3.4, 0.996, 0.99, 12, 0)).toBe(0)
    new Uint8Array(e.memory.buffer, e.ex.solidBuf(), NX * NY).set(terrain.mask)
    e.ex.rebuildSolid()
    e.ex.setAmbient(0.5, 0, 0)
    // 地形 SDF 场上传（与流体同源烘焙）
    new Float32Array(e.memory.buffer, e.ex.tSdfBuf(), e.ex.tSdfCap()).set(terrain.field)
    // 热源表：羽流重生路径
    const src = new Float32Array(e.memory.buffer, e.ex.tSrcBuf(), e.ex.tSrcCap() * 2)
    src[0] = 30
    src[1] = 36
    src[2] = 50
    src[3] = 30
  }

  for (const e of [as, mbt]) {
    expect(
      e.ex.tracersInit(COUNT, TRAIL_LEN, NX * CELL, NY * CELL, 0, NX, NY, CELL, 0, 0, SEED),
    ).toBe(0)
  }

  // init 后即刻对比（scatter 重生全链路）
  for (const [name, ptr] of [['x', 'tXBuf'], ['y', 'tYBuf'], ['life', 'tLifeBuf']] as const) {
    bitsEqual(
      new Float32Array(as.memory.buffer, as.ex[ptr](), COUNT),
      new Float32Array(mbt.memory.buffer, mbt.ex[ptr](), COUNT),
      `init 后 ${name}`,
    )
  }

  for (let i = 0; i < 240; i++) {
    as.ex.tracersStep(DT, 2)
    mbt.ex.tracersStep(DT, 2)
  }

  expect(mbt.ex.tTime()).toBe(as.ex.tTime())
  for (const [name, ptr, len] of [
    ['x', 'tXBuf', COUNT],
    ['y', 'tYBuf', COUNT],
    ['life', 'tLifeBuf', COUNT],
    ['maxLife', 'tMaxLifeBuf', COUNT],
    ['trailX', 'tTrailXBuf', COUNT * TRAIL_LEN],
    ['trailY', 'tTrailYBuf', COUNT * TRAIL_LEN],
    ['trailT', 'tTrailTBuf', COUNT * TRAIL_LEN],
  ] as const) {
    bitsEqual(
      new Float32Array(as.memory.buffer, as.ex[ptr](), len),
      new Float32Array(mbt.memory.buffer, mbt.ex[ptr](), len),
      `240 步后 ${name}`,
    )
  }
  bitsEqual(
    new Uint8Array(as.memory.buffer, as.ex.tTrailNBuf(), COUNT),
    new Uint8Array(mbt.memory.buffer, mbt.ex.tTrailNBuf(), COUNT),
    '240 步后 trailN',
  )
})

test('示踪粒子：init 参数校验', () => {
  for (const e of [bootAs(), bootMbt()]) {
    expect(e.ex.tracersInit(399, TRAIL_LEN, 72, 54, 0, NX, NY, CELL, 0, 0, 1)).toBe(1)
    expect(e.ex.tracersInit(COUNT, 23, 72, 54, 0, NX, NY, CELL, 0, 0, 1)).toBe(1)
    expect(e.ex.tracersInit(COUNT, TRAIL_LEN, 72, 54, 0, 200, 200, CELL, 0, 0, 1)).toBe(2)
  }
})
