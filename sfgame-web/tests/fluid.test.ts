import { expect, test } from 'vitest'
import { bilinearSample, createFluid, type FluidConfig } from '../app/sim/fluid.ts'
import { bakeTerrain } from '../app/sim/terrain.ts'
import { createEngine } from '../app/wasm/engine.ts'

const CFG: FluidConfig = {
  nx: 48,
  ny: 36,
  cell: 1.5,
  buoyancy: 2.0,
  tMax: 9,
  heatRate: 18,
  sourceRadius: 3.4,
  velDamping: 0.996,
  tDamping: 0.99,
  iterations: 12,
  margin: 0,
}

const DT = 1 / 60

test('热源上方产生上升风（y 向下，上升即 v < 0）', () => {
  const f = createFluid(CFG)
  for (let i = 0; i < 120; i++) {
    f.addHeat(36, 38, 16 * DT)
    f.step(DT)
  }
  const air = { x: 0, y: 0 }
  f.sampleVelocity(36, 32, air)
  expect(air.y).toBeLessThan(0)
  expect(-air.y).toBeGreaterThan(2)
})

test('冷源产生下沉风', () => {
  const f = createFluid(CFG)
  for (let i = 0; i < 120; i++) {
    f.addHeat(36, 20, -16 * DT)
    f.step(DT)
  }
  const air = { x: 0, y: 0 }
  f.sampleVelocity(36, 26, air)
  expect(air.y).toBeGreaterThan(0)
})

test('固体掩码内无速度', () => {
  const f = createFluid(CFG)
  f.setTerrain(bakeTerrain((_x, y) => 45 - y, { w: 72, h: 54 }, CFG.cell, 0))
  f.addHeat(30, 40, 5)
  for (let i = 0; i < 60; i++) f.step(DT)
  const air = { x: 0, y: 0 }
  f.sampleVelocity(30, 46.5, air)
  expect(Math.abs(air.x)).toBe(0)
  expect(Math.abs(air.y)).toBe(0)
})

test('超编译期容量拒绝创建（无静默回退）', () => {
  expect(() => createFluid({ ...CFG, nx: 400, ny: 300 })).toThrow()
})

// 零拷贝采样与内核导出路径逐位一致（门面已改走 bilinearSample，内核导出作基准防回归）
test('门面 sampleVelocity 与内核导出 sampleVelocity 逐位一致', () => {
  const engine = createEngine()
  const f = createFluid(CFG, engine)
  f.setAmbient(0.3, -0.2)
  for (let i = 0; i < 120; i++) {
    f.addHeat(36, 38, 16 * DT)
    f.step(DT)
  }
  const { u, v, t, fxU, fxV } = f.fieldViews()
  const out1 = { x: 0, y: 0 }
  const out2 = { x: 0, y: 0 }
  for (let k = 0; k < 64; k++) {
    const px = ((k * 7.13) % 68) + 0.4
    const py = ((k * 3.77) % 48) + 0.4
    const temp = bilinearSample(u, v, t, fxU, fxV, CFG.nx, CFG.ny, CFG.cell, 0, 0, 0.3, -0.2, px, py, out1)
    f.sampleVelocity(px, py, out2)
    expect(out1.x).toBe(out2.x)
    expect(out1.y).toBe(out2.y)
    engine.ex.sampleVelocity(px, py)
    expect(out2.x).toBe(engine.ex.outX())
    expect(out2.y).toBe(engine.ex.outY())
    expect(temp).toBe(f.sampleTemp(px, py))
  }
})

// 生产路径 margin>0（origin 偏移格）：JS bilinearSample 与内核导出逐位一致——margin=0 只钉主路径，
// 生产每关 margin=10，若内核采样公式漂移只更新 golden 探针会漏掉 JS 侧
test('margin>0 采样：门面/内核导出/JS bilinearSample 逐位一致', () => {
  const engine = createEngine()
  const cfg: FluidConfig = { ...CFG, nx: 56, ny: 40, margin: 6 }
  const f = createFluid(cfg, engine)
  f.setAmbient(0.3, -0.2)
  for (let i = 0; i < 120; i++) {
    f.addHeat(42, 30, 16 * DT)
    f.step(DT)
  }
  const { u, v, t, fxU, fxV } = f.fieldViews()
  const org = engine.origin
  const out1 = { x: 0, y: 0 }
  const out2 = { x: 0, y: 0 }
  for (let k = 0; k < 64; k++) {
    const px = ((k * 7.13) % 80) + 0.4
    const py = ((k * 3.77) % 56) + 0.4
    bilinearSample(u, v, t, fxU, fxV, cfg.nx, cfg.ny, cfg.cell, org.x, org.y, 0.3, -0.2, px, py, out1)
    f.sampleVelocity(px, py, out2)
    expect(out1.x).toBe(out2.x)
    expect(out1.y).toBe(out2.y)
    engine.ex.sampleVelocity(px, py)
    expect(out2.x).toBe(engine.ex.outX())
    expect(out2.y).toBe(engine.ex.outY())
  }
})

// 位流基场：横向环境风贴地绕流——迎风坡爬升、背风坡下沉（y 向下，上升 = v<0）
test('ambient 横向风顺坡而上（基场绕流）', () => {
  const f = createFluid(CFG)
  // 中央平滑山丘：y=44 平原隆起至 y=30
  const ground = (x: number) => 44 - 14 * Math.exp(-((x - 36) ** 2) / 40)
  f.setTerrain(bakeTerrain((x, y) => ground(x) - y, { w: 72, h: 54 }, CFG.cell, 0))
  f.setAmbient(1, 0)
  const air = { x: 0, y: 0 }
  // 远场 ≈ 均匀横向风
  f.sampleVelocity(12, 20, air)
  expect(air.x).toBeGreaterThan(0.8)
  expect(Math.abs(air.y)).toBeLessThan(0.2)
  // 迎风坡近地处向上爬
  f.sampleVelocity(30, ground(30) - 3, air)
  expect(air.y).toBeLessThan(-0.05)
  // 背风坡近地处向下沉
  f.sampleVelocity(42, ground(42) - 3, air)
  expect(air.y).toBeGreaterThan(0.05)
})

// 环境温度偏置：不进状态场、浮力消费时叠加——热=全域升、冷=全域沉；sampleTemp 返回总温度
test('ambient.temp 均匀温度偏置驱动全域升沉流', () => {
  const cfg: FluidConfig = {
    nx: 56,
    ny: 40,
    cell: 1.5,
    buoyancy: 2,
    tMax: 9,
    heatRate: 0,
    sourceRadius: 3.4,
    velDamping: 1,
    tDamping: 1,
    iterations: 12,
    margin: 6,
  }
  const air = { x: 0, y: 0 }
  // 冷：均匀下沉（y 向下，下沉即 v > 0）
  const fc = createFluid(cfg)
  fc.setAmbient(0, 0, -0.5)
  for (let i = 0; i < 30; i++) fc.step(DT)
  fc.sampleVelocity(42, 27, air)
  expect(air.y).toBeGreaterThan(0.1)
  // 感受温度 = 场温（无源≈ 0）+ 偏置
  expect(fc.sampleTemp(42, 27)).toBeCloseTo(-0.5, 5)
  // 热：均匀上升，符号相反
  const fh = createFluid(cfg)
  fh.setAmbient(0, 0, 0.5)
  for (let i = 0; i < 30; i++) fh.step(DT)
  fh.sampleVelocity(42, 27, air)
  expect(air.y).toBeLessThan(-0.1)
  expect(fh.sampleTemp(42, 27)).toBeCloseTo(0.5, 5)
})

// 开放域：流体网格 = 地图外扩边距。风流出地图无墙体堆积；边距吸收层清理流出的热，不反射回场内
test('流出边界：风丝滑流出地图，边距吸收外流能量', () => {
  const f = createFluid({
    nx: 56,
    ny: 40,
    cell: 1.5,
    buoyancy: 0,
    tMax: 9,
    heatRate: 0,
    sourceRadius: 3.4,
    velDamping: 1,
    tDamping: 1,
    iterations: 12,
    margin: 6,
  })
  f.setAmbient(1, 0)
  const air = { x: 0, y: 0 }
  // 地图右界外不远处：风速仍≈远场值（旧封闭盒在此处会堆积减速）
  f.sampleVelocity(73.5, 27, air)
  expect(air.x).toBeGreaterThan(0.8)
  // 持续在地图右缘注热：横向风把热带出地图，边距吸收后不回流
  for (let i = 0; i < 300; i++) {
    f.addHeat(70, 27, 8 * DT)
    f.step(DT)
  }
  expect(f.sampleTemp(70, 27)).toBeGreaterThan(2)
  expect(f.sampleTemp(76, 27)).toBeLessThan(1.5)
  // 上风侧（注入点左侧远处）不被扩散污染
  expect(f.sampleTemp(40, 27)).toBeLessThan(0.3)
})
