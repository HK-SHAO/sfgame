// AssemblyScript 流体内核（与 src/sim/fluid.ts 同算法）。游戏级精度：f32 存储，
// 场运算以 f32x4 SIMD 为主；压强/散度/梯度是耗散算子，f32 舍入不会危害玩法；
// 平流误差补偿是混沌放大环节，入口侧刻意用 f64x2 保持与 JS 后端一致的轨迹品质。
// 静态容量 + stub runtime：实例化时一次性分配，运行期零分配、无 GC、memory.buffer 视图恒定。

export const MAX_NX = 160
export const MAX_NY = 120
const MAX_CELLS = MAX_NX * MAX_NY

export const u = new Float32Array(MAX_CELLS)
export const v = new Float32Array(MAX_CELLS)
export const t = new Float32Array(MAX_CELLS)
export const solid = new Uint8Array(MAX_CELLS)
export const u0 = new Float32Array(MAX_CELLS)
export const v0 = new Float32Array(MAX_CELLS)
export const t0 = new Float32Array(MAX_CELLS)
export const q1 = new Float32Array(MAX_CELLS)
export const q2 = new Float32Array(MAX_CELLS)
export const p = new Float32Array(MAX_CELLS)
export const div = new Float32Array(MAX_CELLS)
export const divH2 = new Float64Array(MAX_CELLS)
export const curl = new Float32Array(MAX_CELLS)
export const solidF = new Float32Array(MAX_CELLS)
const solidList = new Int32Array(MAX_CELLS)
export const inGroup = new Uint8Array(MAX_CELLS)
let solidCount = 0
// 压强 GS 拆分：8 格组（四邻全流体的整块）走 SIMD 直通，其余（邻接固体/行尾）走标量替换分支
export const coreGroup = new Int32Array(MAX_CELLS)
export const bndEven = new Int32Array(MAX_CELLS)
export const bndOdd = new Int32Array(MAX_CELLS)
export let coreGroupN = 0
export let bndEvenN = 0
export let bndOddN = 0

export let nx = 0
export let ny = 0
export let cell: f64 = 0
export let buoyancy: f64 = 0
let tMax: f64 = 0
let heatRate: f64 = 0
let sourceRadius: f64 = 0
export let velDamping: f64 = 0
export let tDamping: f64 = 0
export let iterations: i32 = 0
export let vorticity: f64 = 0
let ambientX: f64 = 0
let ambientY: f64 = 0

let outVX: f64 = 0
let outVY: f64 = 0

export function init(
  nx_: i32,
  ny_: i32,
  cell_: f64,
  buoyancy_: f64,
  tMax_: f64,
  heatRate_: f64,
  sourceRadius_: f64,
  velDamping_: f64,
  tDamping_: f64,
  iterations_: i32,
  vorticity_: f64,
): i32 {
  if (nx_ < 3 || ny_ < 3 || nx_ > MAX_NX || ny_ > MAX_NY) return 1
  nx = nx_
  ny = ny_
  cell = cell_
  buoyancy = buoyancy_
  tMax = tMax_
  heatRate = heatRate_
  sourceRadius = sourceRadius_
  velDamping = velDamping_
  tDamping = tDamping_
  iterations = iterations_
  vorticity = vorticity_
  ambientX = 0
  ambientY = 0
  clear()
  return 0
}

export function clear(): void {
  const bytes = <usize>(nx * ny) << 2
  memory.fill(u.dataStart, 0, bytes)
  memory.fill(v.dataStart, 0, bytes)
  memory.fill(t.dataStart, 0, bytes)
  memory.fill(p.dataStart, 0, bytes)
}

export function setAmbient(x: f64, y: f64): void {
  ambientX = x
  ambientY = y
}

function isCore(idx: i32): bool {
  return !solid[idx] && !solid[idx - 1] && !solid[idx + 1] && !solid[idx - nx] && !solid[idx + nx]
}

export function rebuildSolid(): void {
  const n = nx * ny
  let c = 0
  coreGroupN = 0
  bndEvenN = 0
  bndOddN = 0
  // 8 格连续组：i 从 1 起步进 8，组内全为 core 格（SIMD 无分支直通的前提）
  for (let j = 0; j < ny; j++) {
    const row = j * nx
    for (let i = 1; i + 7 <= nx - 2; i += 8) {
      let all = true
      for (let k = 0; k < 8; k++) {
        if (!isCore(i + k + row)) {
          all = false
          break
        }
      }
      if (all) {
        coreGroup[coreGroupN++] = i + row
        for (let k = 0; k < 8; k++) inGroup[i + k + row] = 1
      }
    }
  }
  for (let j = 0; j < ny; j++) {
    const row = j * nx
    for (let i = 0; i < nx; i++) {
      const idx = i + row
      const s = solid[idx]
      solidF[idx] = <f32>s
      if (s) {
        solidList[c++] = idx
        continue
      }
      const parity = (i + j) & 1
      // 未入组的 core 格走边界表（替换分支对全流体邻域退化为恒等，结果不变）
      if (!isCore(idx) || !inGroup[idx]) {
        if (parity) bndOdd[bndOddN++] = idx
        else bndEven[bndEvenN++] = idx
      }
    }
  }
  solidCount = c
}

export function addHeat(wx: f64, wy: f64, amount: f64): void {
  const gr = sourceRadius / cell
  const gx = wx / cell - 0.5
  const gy = wy / cell - 0.5
  let x0 = <i32>Math.floor(gx - gr)
  if (x0 < 1) x0 = 1
  let x1 = <i32>Math.ceil(gx + gr)
  if (x1 > nx - 2) x1 = nx - 2
  let y0 = <i32>Math.floor(gy - gr)
  if (y0 < 1) y0 = 1
  let y1 = <i32>Math.ceil(gy + gr)
  if (y1 > ny - 2) y1 = ny - 2
  for (let j = y0; j <= y1; j++) {
    const row = j * nx
    for (let i = x0; i <= x1; i++) {
      const idx = i + row
      if (solid[idx]) continue
      const dx = <f64>i - gx
      const dy = <f64>j - gy
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d >= gr) continue
      const falloff = 1 - d / gr
      let val = <f64>t[idx] + amount * falloff
      if (val > tMax) val = tMax
      else if (val < -tMax) val = -tMax
      t[idx] = <f32>val
    }
  }
}

export function sampleVelocity(wx: f64, wy: f64): void {
  let gx = wx / cell - 0.5
  let gy = wy / cell - 0.5
  if (gx < 0) gx = 0
  else if (gx > <f64>nx - 1.001) gx = <f64>nx - 1.001
  if (gy < 0) gy = 0
  else if (gy > <f64>ny - 1.001) gy = <f64>ny - 1.001
  const i0 = <i32>Math.floor(gx)
  const j0 = <i32>Math.floor(gy)
  const fx = gx - <f64>i0
  const fy = gy - <f64>j0
  const a = i0 + j0 * nx
  const b = a + 1
  const c = a + nx
  const d = c + 1
  const w00 = (1 - fx) * (1 - fy)
  const w10 = fx * (1 - fy)
  const w01 = (1 - fx) * fy
  const w11 = fx * fy
  outVX =
    <f64>u[a] * w00 + <f64>u[b] * w10 + <f64>u[c] * w01 + <f64>u[d] * w11 + ambientX
  outVY =
    <f64>v[a] * w00 + <f64>v[b] * w10 + <f64>v[c] * w01 + <f64>v[d] * w11 + ambientY
}

export function outX(): f64 {
  return outVX
}
export function outY(): f64 {
  return outVY
}

export function sampleTemp(wx: f64, wy: f64): f64 {
  let gx = wx / cell - 0.5
  let gy = wy / cell - 0.5
  if (gx < 0) gx = 0
  else if (gx > <f64>nx - 1.001) gx = <f64>nx - 1.001
  if (gy < 0) gy = 0
  else if (gy > <f64>ny - 1.001) gy = <f64>ny - 1.001
  const i0 = <i32>Math.floor(gx)
  const j0 = <i32>Math.floor(gy)
  const fx = gx - <f64>i0
  const fy = gy - <f64>j0
  const a = i0 + j0 * nx
  const b = a + 1
  const c = a + nx
  const d = c + 1
  return (
    <f64>t[a] * (1 - fx) * (1 - fy) +
    <f64>t[b] * fx * (1 - fy) +
    <f64>t[c] * (1 - fx) * fy +
    <f64>t[d] * fx * fy
  )
}

export function applyVorticity(dt: f64): void {
  const h2 = 2 * cell
  for (let j = 1; j < ny - 1; j++) {
    const row = j * nx
    for (let i = 1; i < nx - 1; i++) {
      const idx = i + row
      if (solid[idx]) {
        curl[idx] = 0
        continue
      }
      curl[idx] = <f32>(
        (<f64>v[idx + 1] - <f64>v[idx - 1]) / h2 - (<f64>u[idx + nx] - <f64>u[idx - nx]) / h2
      )
    }
  }
  const f = vorticity * cell * dt
  for (let j = 2; j < ny - 2; j++) {
    const row = j * nx
    for (let i = 2; i < nx - 2; i++) {
      const idx = i + row
      if (solid[idx]) continue
      const dwdx = (Math.abs(<f64>curl[idx + 1]) - Math.abs(<f64>curl[idx - 1])) / h2
      const dwdy = (Math.abs(<f64>curl[idx + nx]) - Math.abs(<f64>curl[idx - nx])) / h2
      const len = Math.sqrt(dwdx * dwdx + dwdy * dwdy) + 1e-5
      const nxN = dwdx / len
      const nyN = dwdy / len
      const w = <f64>curl[idx]
      u[idx] = <f32>(<f64>u[idx] + f * nyN * w)
      v[idx] = <f32>(<f64>v[idx] - f * nxN * w)
    }
  }
}

export function copyFields(): void {
  const bytes = <usize>(nx * ny) << 2
  memory.copy(u0.dataStart, u.dataStart, bytes)
  memory.copy(v0.dataStart, v.dataStart, bytes)
  memory.copy(t0.dataStart, t.dataStart, bytes)
}

// 单趟半拉格朗日平流：sign=1 回溯 / -1 前推（gather 无法向量化，全模块唯一标量场通路）
export function advectPass(dst: Float32Array, src: Float32Array, dt: f64, sign: f64): void {
  const dt0 = (dt / cell) * sign
  for (let j = 1; j < ny - 1; j++) {
    const row = j * nx
    for (let i = 1; i < nx - 1; i++) {
      const idx = i + row
      if (solid[idx]) {
        dst[idx] = 0
        continue
      }
      let x = <f64>i - dt0 * <f64>u0[idx]
      let y = <f64>j - dt0 * <f64>v0[idx]
      if (x < 0.5) x = 0.5
      else if (x > <f64>nx - 1.5) x = <f64>nx - 1.5
      if (y < 0.5) y = 0.5
      else if (y > <f64>ny - 1.5) y = <f64>ny - 1.5
      const i0 = <i32>x
      const j0 = <i32>y
      const fx = x - <f64>i0
      const fy = y - <f64>j0
      const a = i0 + j0 * nx
      const b = a + 1
      const c = a + nx
      const d = c + 1
      dst[idx] = <f32>(
        <f64>src[a] * (1 - fx) * (1 - fy) +
        <f64>src[b] * fx * (1 - fy) +
        <f64>src[c] * (1 - fx) * fy +
        <f64>src[d] * fx * fy
      )
    }
  }
}

// MacCormack 补偿的单格标量版：SIMD 车道组的行尾与边界格复用
export function correctCell(idx: i32, dst: Float32Array, src: Float32Array, damping: f64): void {
  if (solid[idx]) {
    dst[idx] = 0
    return
  }
  let lo = <f64>src[idx]
  let hi = lo
  let s: f64
  s = <f64>src[idx - nx - 1]
  if (s < lo) lo = s
  else if (s > hi) hi = s
  s = <f64>src[idx - nx]
  if (s < lo) lo = s
  else if (s > hi) hi = s
  s = <f64>src[idx - nx + 1]
  if (s < lo) lo = s
  else if (s > hi) hi = s
  s = <f64>src[idx - 1]
  if (s < lo) lo = s
  else if (s > hi) hi = s
  s = <f64>src[idx]
  if (s < lo) lo = s
  else if (s > hi) hi = s
  s = <f64>src[idx + 1]
  if (s < lo) lo = s
  else if (s > hi) hi = s
  s = <f64>src[idx + nx - 1]
  if (s < lo) lo = s
  else if (s > hi) hi = s
  s = <f64>src[idx + nx]
  if (s < lo) lo = s
  else if (s > hi) hi = s
  s = <f64>src[idx + nx + 1]
  if (s < lo) lo = s
  else if (s > hi) hi = s
  let val = <f64>q1[idx] + (<f64>src[idx] - <f64>q2[idx]) * 0.5
  if (val < lo) val = lo
  else if (val > hi) val = hi
  dst[idx] = <f32>(val * damping)
}

export function enforceBoundary(): void {
  for (let k = 0; k < solidCount; k++) {
    const idx = solidList[k]
    u[idx] = 0
    v[idx] = 0
    t[idx] = 0
  }
}

export function fieldU(): usize {
  return u.dataStart
}
export function fieldV(): usize {
  return v.dataStart
}
export function fieldT(): usize {
  return t.dataStart
}
export function solidBuf(): usize {
  return solid.dataStart
}
