// 示踪粒子内核（app/sim/particles.ts 门面的数值实现）：粒子状态全量驻留 wasm 内存，
// 宿主每 tick 只写热源表并单次调用推进——风场采样直调 core（同模块零跨界）、地面走 LUT。
// 粒子纯视觉不涉判定：PRNG 用确定性 mulberry32（宿主播种），位级不与 JS 旧实现对齐。
// 静态容量 + stub runtime：实例化定型、运行期零分配。
import { sampleVelocity, outX, outY } from './core'

export const T_COUNT = 400
const T_TRAIL_LEN = 24
const T_TRAIL_SAMPLE = 0.45
const T_RESPAWN_TRIES = 8
const T_PLUME_PER_STEP = 2
const T_PLUME_RADIUS = 1.6
const T_PLUME_LIFE_MIN = 0.9
const T_PLUME_LIFE_SPAN = 1.2
const T_LUT_CAP = 1024
const T_SRC_CAP = 32

const tx = new Float32Array(T_COUNT)
const ty = new Float32Array(T_COUNT)
const tLife = new Float32Array(T_COUNT)
const tMaxLife = new Float32Array(T_COUNT)
const tOdo = new Float32Array(T_COUNT)
const tLastOdo = new Float32Array(T_COUNT)
const trailX = new Float32Array(T_COUNT * T_TRAIL_LEN)
const trailY = new Float32Array(T_COUNT * T_TRAIL_LEN)
const trailT = new Float32Array(T_COUNT * T_TRAIL_LEN)
const trailN = new Uint8Array(T_COUNT)
// 地面 LUT：宿主烘焙 groundY（世界坐标 [0,w]），查询端外钳制取边缘值（同 groundExt 语义）
const groundLut = new Float32Array(T_LUT_CAP)
const srcBuf = new Float32Array(T_SRC_CAP * 2)

let time: f64 = 0
let worldW: f64 = 0
let margin: f64 = 0
let lutN: i32 = 0
let lutStep: f64 = 1
let rngState: u32 = 0x9e3779b9

function rnd(): f64 {
  // mulberry32：u32 算术自然回绕（与 imul 位级等价）
  rngState += <u32>0x6d2b79f5
  let z: u32 = rngState
  z = (z ^ (z >>> 15)) * (z | <u32>1)
  z ^= z + (z ^ (z >>> 7)) * (z | <u32>61)
  return <f64>(z ^ (z >>> 14)) / 4294967296
}

function groundAt(x: f64): f64 {
  let cx = x
  if (cx < 0) cx = 0
  else if (cx > worldW) cx = worldW
  const f = cx / lutStep
  let i = <i32>f
  if (i >= lutN - 1) return <f64>groundLut[lutN - 1]
  const fr = f - <f64>i
  return <f64>groundLut[i] * (1 - fr) + <f64>groundLut[i + 1] * fr
}

function resetTrail(i: i32): void {
  tOdo[i] = 0
  tLastOdo[i] = 0
  trailN[i] = 0
}

function recordTrail(i: i32): void {
  const base = i * T_TRAIL_LEN
  const n = <i32>trailN[i]
  if (n < T_TRAIL_LEN) {
    trailX[base + n] = tx[i]
    trailY[base + n] = ty[i]
    trailT[base + n] = <f32>time
    trailN[i] = <u8>(n + 1)
  } else {
    trailX.copyWithin(base, base + 1, base + T_TRAIL_LEN)
    trailY.copyWithin(base, base + 1, base + T_TRAIL_LEN)
    trailT.copyWithin(base, base + 1, base + T_TRAIL_LEN)
    trailX[base + T_TRAIL_LEN - 1] = tx[i]
    trailY[base + T_TRAIL_LEN - 1] = ty[i]
    trailT[base + T_TRAIL_LEN - 1] = <f32>time
  }
  tLastOdo[i] = tOdo[i]
}

function respawn(i: i32, scatter: bool): void {
  for (let tries = 0; tries < T_RESPAWN_TRIES; tries++) {
    // 重生范围与边界严格镜像 [0.5, w-0.5]（左右空白带一致）
    const x = 0.5 + rnd() * (worldW - 1)
    const ceil = groundAt(x) - 1.5
    if (ceil < 3) continue
    const y = 2 + rnd() * (ceil - 2)
    tx[i] = <f32>x
    ty[i] = <f32>y
    tMaxLife[i] = <f32>(2.5 + rnd() * 4)
    tLife[i] = <f32>(scatter ? rnd() * <f64>tMaxLife[i] : <f64>tMaxLife[i])
    resetTrail(i)
    // 出生即记首段轨迹：左缘粒子出生即被风带走，延迟会墙边留空
    recordTrail(i)
    return
  }
  tx[i] = -100
  ty[i] = -100
  tLife[i] = 0.1
  resetTrail(i)
}

// LUT 须先由宿主写入 groundLut 再调用；count/trailLen 与编译期容量不符返回非 0（拒绝创建）
export function tracersInit(
  count: i32, trailLen: i32, worldW_: f64, margin_: f64, lutStep_: f64, seed: u32,
): i32 {
  if (count != T_COUNT || trailLen != T_TRAIL_LEN) return 1
  worldW = worldW_
  margin = margin_
  lutStep = lutStep_
  lutN = <i32>(worldW / lutStep) + 1
  if (lutN < 2 || lutN > T_LUT_CAP) return 2
  rngState = seed
  time = 0
  for (let i = 0; i < T_COUNT; i++) respawn(i, true)
  return 0
}

export function tracersStep(dt: f64, srcCount: i32): void {
  time += dt
  const m = margin
  for (let i = 0; i < T_COUNT; i++) {
    tLife[i] = <f32>(<f64>tLife[i] - dt)
    if (tLife[i] <= 0) {
      respawn(i, false)
      continue
    }
    sampleVelocity(<f64>tx[i], <f64>ty[i])
    const nx = <f64>tx[i] + (outX() + (rnd() - 0.5) * 0.5) * dt
    const ny = <f64>ty[i] + (outY() + (rnd() - 0.5) * 0.5) * dt
    const dx = nx - <f64>tx[i]
    const dy = ny - <f64>ty[i]
    tOdo[i] = <f32>(<f64>tOdo[i] + Math.sqrt(dx * dx + dy * dy))
    tx[i] = <f32>nx
    ty[i] = <f32>ny
    if (<f64>tOdo[i] - <f64>tLastOdo[i] >= T_TRAIL_SAMPLE) recordTrail(i)
    // 允许飞出地图：边距内继续随风流动，接近末端才清理（可见区无堆积/断崖）
    if (ny > groundAt(nx) - 0.4 || ny < 1 - m || nx < 1 - m || nx > worldW + m - 1) {
      respawn(i, false)
    }
  }

  if (srcCount > 0) {
    for (let n = 0; n < T_PLUME_PER_STEP; n++) {
      const s = <i32>(rnd() * <f64>srcCount)
      const i = <i32>(rnd() * <f64>T_COUNT)
      const ang = rnd() * Math.PI * 2
      const rad = rnd() * T_PLUME_RADIUS
      const x = <f64>srcBuf[s * 2] + Math.cos(ang) * rad
      const y = <f64>srcBuf[s * 2 + 1] + Math.sin(ang) * rad
      if (y > groundAt(x) - 0.6 || y < 1) continue
      tx[i] = <f32>x
      ty[i] = <f32>y
      tMaxLife[i] = <f32>(T_PLUME_LIFE_MIN + rnd() * T_PLUME_LIFE_SPAN)
      tLife[i] = tMaxLife[i]
      resetTrail(i)
      recordTrail(i)
    }
  }
}

export function tTime(): f64 {
  return time
}
export function tXBuf(): usize {
  return tx.dataStart
}
export function tYBuf(): usize {
  return ty.dataStart
}
export function tLifeBuf(): usize {
  return tLife.dataStart
}
export function tMaxLifeBuf(): usize {
  return tMaxLife.dataStart
}
export function tTrailXBuf(): usize {
  return trailX.dataStart
}
export function tTrailYBuf(): usize {
  return trailY.dataStart
}
export function tTrailTBuf(): usize {
  return trailT.dataStart
}
export function tTrailNBuf(): usize {
  return trailN.dataStart
}
export function tLutBuf(): usize {
  return groundLut.dataStart
}
export function tLutCap(): i32 {
  return T_LUT_CAP
}
export function tSrcBuf(): usize {
  return srcBuf.dataStart
}
export function tSrcCap(): i32 {
  return T_SRC_CAP
}
