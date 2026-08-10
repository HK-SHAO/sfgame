// 示踪粒子内核（app/sim/particles.ts 门面的数值实现）：粒子状态全量驻留 wasm 内存，
// 宿主每 tick 只写热源表并单次调用推进——风场采样直调 core（同模块零跨界）、地形走宿主烘焙的 SDF 场。
// 粒子纯视觉不涉判定：PRNG 用确定性 mulberry32（宿主播种），位级不与 JS 旧实现对齐。
// 静态容量 + stub runtime：实例化定型、运行期零分配。
import { sampleVelocity, outX, outY } from './core'

export const T_COUNT = 400
const T_TRAIL_LEN = 24
const T_TRAIL_SAMPLE = 0.45
const T_RESPAWN_TRIES = 8
const T_PLUME_RADIUS = 1.6
const T_PLUME_LIFE_MIN = 0.9
const T_PLUME_LIFE_SPAN = 1.2
// 自然死亡转生羽流的概率：稳态羽流密度 ≈ 死亡率×概率×羽流寿命，与原强夺式注入同量级
const T_PLUME_CHANCE = 0.7
const T_PLUME_TRIES = 4
// 地形场容量：流体网格最大规格（nx×ny）上限，超限 init 拒绝
const T_SDF_CAP = 19200
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
// 地形 SDF 场：宿主烘焙后原样上传（与流体掩码/飞机碰撞同源），格心值、双线性采样
const tSdf = new Float32Array(T_SDF_CAP)
const srcBuf = new Float32Array(T_SRC_CAP * 2)

let time: f64 = 0
let worldW: f64 = 0
let worldH: f64 = 0
let margin: f64 = 0
let snx: i32 = 0
let sny: i32 = 0
let scell: f64 = 1
let sox: f64 = 0
let soy: f64 = 0
let rngState: u32 = 0x9e3779b9
let srcNow: i32 = 0

function rnd(): f64 {
  // mulberry32：u32 算术自然回绕（与 imul 位级等价）
  rngState += <u32>0x6d2b79f5
  let z: u32 = rngState
  z = (z ^ (z >>> 15)) * (z | <u32>1)
  z ^= z + (z ^ (z >>> 7)) * (z | <u32>61)
  return <f64>(z ^ (z >>> 14)) / 4294967296
}

// 双线性采样烘焙场：clamp 约定与 app/sim/terrain.ts sample 同构（域外取边缘值 = 地形延展）
function sdfAt(x: f64, y: f64): f64 {
  let gx = x / scell - 0.5 + sox
  let gy = y / scell - 0.5 + soy
  if (gx < 0) gx = 0
  else if (gx > <f64>snx - 1.001) gx = <f64>snx - 1.001
  if (gy < 0) gy = 0
  else if (gy > <f64>sny - 1.001) gy = <f64>sny - 1.001
  const i0 = <i32>gx
  const j0 = <i32>gy
  const fx = gx - <f64>i0
  const fy = gy - <f64>j0
  const a = i0 + j0 * snx
  return (
    <f64>tSdf[a] * (1 - fx) * (1 - fy) +
    <f64>tSdf[a + 1] * fx * (1 - fy) +
    <f64>tSdf[a + snx] * (1 - fx) * fy +
    <f64>tSdf[a + snx + 1] * fx * fy
  )
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
  // 有热源时自然死亡按概率转生为羽流：粒子本已淡出完毕（env→0），无 alpha 突变；
  // 旧式强夺活粒子会让被夺者可见轨迹瞬消
  if (!scatter && srcNow > 0 && rnd() < T_PLUME_CHANCE) {
    for (let tries = 0; tries < T_PLUME_TRIES; tries++) {
      const s = <i32>(rnd() * <f64>srcNow)
      const ang = rnd() * Math.PI * 2
      const rad = rnd() * T_PLUME_RADIUS
      const x = <f64>srcBuf[s * 2] + Math.cos(ang) * rad
      const y = <f64>srcBuf[s * 2 + 1] + Math.sin(ang) * rad
      if (sdfAt(x, y) < 0.6 || y < 1) continue
      tx[i] = <f32>x
      ty[i] = <f32>y
      tMaxLife[i] = <f32>(T_PLUME_LIFE_MIN + rnd() * T_PLUME_LIFE_SPAN)
      tLife[i] = tMaxLife[i]
      resetTrail(i)
      recordTrail(i)
      return
    }
  }
  for (let tries = 0; tries < T_RESPAWN_TRIES; tries++) {
    // 拒绝采样：全场随机投点，落在离地表 ≥1.5 的空气区才出生（SDF 天然兼容任意地形）
    const x = 0.5 + rnd() * (worldW - 1)
    const y = 2 + rnd() * (worldH - 3)
    if (sdfAt(x, y) < 1.5) continue
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

// SDF 场须先由宿主写入 tSdf 再调用；count/trailLen/场容量与编译期容量不符返回非 0（拒绝创建）
export function tracersInit(
  count: i32, trailLen: i32, worldW_: f64, worldH_: f64, margin_: f64,
  snx_: i32, sny_: i32, scell_: f64, sox_: f64, soy_: f64, seed: u32,
): i32 {
  if (count != T_COUNT || trailLen != T_TRAIL_LEN) return 1
  if (snx_ < 2 || sny_ < 2 || snx_ * sny_ > T_SDF_CAP) return 2
  worldW = worldW_
  worldH = worldH_
  margin = margin_
  snx = snx_
  sny = sny_
  scell = scell_
  sox = sox_
  soy = soy_
  rngState = seed
  time = 0
  for (let i = 0; i < T_COUNT; i++) respawn(i, true)
  return 0
}

export function tracersStep(dt: f64, srcCount: i32): void {
  time += dt
  srcNow = srcCount
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
    // 允许飞出地图：边距内继续随风流动，接近末端才清理（可见区无堆积/断崖）；进地即重生
    if (sdfAt(nx, ny) < 0.4 || ny < 1 - m || nx < 1 - m || nx > worldW + m - 1) {
      respawn(i, false)
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
export function tSdfBuf(): usize {
  return tSdf.dataStart
}
export function tSdfCap(): i32 {
  return T_SDF_CAP
}
export function tSrcBuf(): usize {
  return srcBuf.dataStart
}
export function tSrcCap(): i32 {
  return T_SRC_CAP
}
