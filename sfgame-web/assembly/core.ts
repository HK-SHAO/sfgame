// AssemblyScript 流体内核（与 app/sim/fluid.ts 同算法）。游戏级精度：f32 存储，
// 场运算以 f32x4 SIMD 为主；压强/散度/梯度是耗散算子，f32 舍入不会危害玩法；
// 平流误差补偿是混沌放大环节，入口侧刻意用 f64x2 保持与 JS 后端一致的轨迹品质。
// 静态容量 + stub runtime：实例化时一次性分配，运行期零分配、无 GC、memory.buffer 视图恒定。

const MAX_NX = 160
const MAX_NY = 120
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
const curl = new Float32Array(MAX_CELLS)
export const solidF = new Float32Array(MAX_CELLS)
// 环境风位流基场：远场单位水平风的贴地绕流（烘焙一次，采样按强度线性叠加）
export const fxU = new Float32Array(MAX_CELLS)
export const fxV = new Float32Array(MAX_CELLS)
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
// 地图在网格内的原点偏移（格）：流体域 = 地图外扩边距，世界坐标 → 网格需加偏移
let ox: i32 = 0
let oy: i32 = 0
// 边距吸收层（sponge）：越靠外壁衰减越强，能量在撞墙反射前被吸收，地图内恒不生效
let marginCells: i32 = 0
let spongeVelIn: f64 = 0
let spongeVelOut: f64 = 0
let spongeTOut: f64 = 0
export let iterations: i32 = 0
export let vorticity: f64 = 0
let ambientX: f64 = 0
let ambientY: f64 = 0
// 环境温度偏置：不进状态场，消费时叠加（浮力 t+ambientT、sampleTemp）；
// 0 时 t+0 逐位不变，存量关卡位级不受影响
export let ambientT: f64 = 0

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
  marginCells_: i32,
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
  marginCells = marginCells_
  ox = marginCells_
  oy = marginCells_
  spongeVelIn = 0.999
  spongeVelOut = 0.97
  spongeTOut = 0.94
  ambientX = 0
  ambientY = 0
  ambientT = 0
  clear()
  bakeAmbientBasis()
  return 0
}

export function clear(): void {
  const bytes = <usize>(nx * ny) << 2
  memory.fill(u.dataStart, 0, bytes)
  memory.fill(v.dataStart, 0, bytes)
  memory.fill(t.dataStart, 0, bytes)
  memory.fill(p.dataStart, 0, bytes)
}

export function setAmbient(x: f64, y: f64, temp: f64): void {
  ambientX = x
  ambientY = y
  ambientT = temp
}

// 环境风 = 预烘焙位流基场 × 强度（不再采样叠裸常数）：远场单位水平风、地面/顶面不可穿透、
// 左右开边界——风自然顺坡爬升、绕崖壁；潮汐 = 强度时间序列（线性叠加保幅保相）。
// 基场与热羽流/风扇完全解耦（不在 step 流水线内）。Scratch 复用 p（烘焙不在 step 内，
// 结束后清零避免干扰压强 warm-start）
function bakeAmbientBasis(): void {
  // φ 初值 = x 坡道：远场 ∇φ = (1,0)；固体/边界值在迭代中按规则代入，无需单独初始化
  for (let j = 0; j < ny; j++) {
    const row = j * nx
    for (let i = 0; i < nx; i++) {
      p[i + row] = <f32>i
    }
  }
  // SOR：左右边列固体 = Dirichlet 坡道（进出口）；地面/顶面固体 = Neumann 镜像（无穿透）
  const omega = 1.85
  for (let it = 0; it < 200; it++) {
    for (let j = 1; j < ny - 1; j++) {
      const row = j * nx
      for (let i = 1; i < nx - 1; i++) {
        const idx = i + row
        if (solid[idx]) continue
        let pL: f64
        if (solid[idx - 1]) pL = i - 1 == 0 ? 0 : <f64>p[idx]
        else pL = <f64>p[idx - 1]
        let pR: f64
        if (solid[idx + 1]) pR = i + 1 == nx - 1 ? <f64>(nx - 1) : <f64>p[idx]
        else pR = <f64>p[idx + 1]
        let pU: f64
        if (solid[idx - nx]) pU = <f64>p[idx]
        else pU = <f64>p[idx - nx]
        let pD: f64
        if (solid[idx + nx]) pD = <f64>p[idx]
        else pD = <f64>p[idx + nx]
        p[idx] = <f32>(<f64>p[idx] + omega * ((pL + pR + pU + pD) * 0.25 - <f64>p[idx]))
      }
    }
  }
  // 速度 = ∇φ 中心差分；固体邻居代入有效值（边列坡道/镜像）——界面法向分量为零，只留切向
  const bytes = <usize>(nx * ny) << 2
  memory.fill(fxU.dataStart, 0, bytes)
  memory.fill(fxV.dataStart, 0, bytes)
  for (let j = 1; j < ny - 1; j++) {
    const row = j * nx
    for (let i = 1; i < nx - 1; i++) {
      const idx = i + row
      if (solid[idx]) continue
      let pL: f64
      if (solid[idx - 1]) pL = i - 1 == 0 ? 0 : <f64>p[idx]
      else pL = <f64>p[idx - 1]
      let pR: f64
      if (solid[idx + 1]) pR = i + 1 == nx - 1 ? <f64>(nx - 1) : <f64>p[idx]
      else pR = <f64>p[idx + 1]
      let pU: f64
      if (solid[idx - nx]) pU = <f64>p[idx]
      else pU = <f64>p[idx - nx]
      let pD: f64
      if (solid[idx + nx]) pD = <f64>p[idx]
      else pD = <f64>p[idx + nx]
      fxU[idx] = <f32>((pR - pL) * 0.5)
      fxV[idx] = <f32>((pD - pU) * 0.5)
    }
  }
  memory.fill(p.dataStart, 0, bytes)
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
  // 8 格连续组：i 从 1 起步进 8，组内全为 core 格（SIMD 无分支直通的前提）。
  // 仅扫 j∈[1,ny-2]：isCore 会读 idx±nx，行 0/ny-1 上的越界索引靠"边行恒为固体"短路豁免，空掩码时会踩 OOB
  for (let j = 1; j < ny - 1; j++) {
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
  bakeAmbientBasis()
}

// 动量注入（风扇等）：以 (fx,fy) 方向为单位，在 radius 圆域内按 falloff 给 u/v 加 amount（JS 侧已含 dt 缩放）；
// 随后的平流/压强投影会把注入量塑造成带卷吸的射流（散度分量被投影抽走）
export function addForce(
  wx: f64,
  wy: f64,
  fx: f64,
  fy: f64,
  amount: f64,
  radius: f64,
): void {
  let len = Math.sqrt(fx * fx + fy * fy)
  if (len < 1e-6) return
  const dxu = fx / len
  const dyv = fy / len
  const gr = radius / cell
  const gx = wx / cell - 0.5 + <f64>ox
  const gy = wy / cell - 0.5 + <f64>oy
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
      u[idx] = <f32>(<f64>u[idx] + amount * dxu * falloff)
      v[idx] = <f32>(<f64>v[idx] + amount * dyv * falloff)
    }
  }
}

export function addHeat(wx: f64, wy: f64, amount: f64): void {  const gr = sourceRadius / cell
  const gx = wx / cell - 0.5 + <f64>ox
  const gy = wy / cell - 0.5 + <f64>oy
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
  let gx = wx / cell - 0.5 + <f64>ox
  let gy = wy / cell - 0.5 + <f64>oy
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
  // 环境风 = 位流基场 × 强度（贴地绕流已烘焙在 fxU/fxV）；ambientY 为裸叠加（关卡均未用非零垂直风，未烘焙垂直基）
  outVX =
    <f64>u[a] * w00 + <f64>u[b] * w10 + <f64>u[c] * w01 + <f64>u[d] * w11 +
    ambientX * (<f64>fxU[a] * w00 + <f64>fxU[b] * w10 + <f64>fxU[c] * w01 + <f64>fxU[d] * w11)
  outVY =
    <f64>v[a] * w00 + <f64>v[b] * w10 + <f64>v[c] * w01 + <f64>v[d] * w11 +
    ambientX * (<f64>fxV[a] * w00 + <f64>fxV[b] * w10 + <f64>fxV[c] * w01 + <f64>fxV[d] * w11) +
    ambientY
}

export function outX(): f64 {
  return outVX
}
export function outY(): f64 {
  return outVY
}

export function sampleTemp(wx: f64, wy: f64): f64 {
  let gx = wx / cell - 0.5 + <f64>ox
  let gy = wy / cell - 0.5 + <f64>oy
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
  // 感受到的总温度 = 场温 + 环境偏置（与浮力消费同一事实源）
  return (
    <f64>t[a] * (1 - fx) * (1 - fy) +
    <f64>t[b] * fx * (1 - fy) +
    <f64>t[c] * (1 - fx) * fy +
    <f64>t[d] * fx * fy
  ) + ambientT
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

// 边距吸收层：仅扫左/右/上三条边距带（约 3k 格），系数随深入边距线性增强。
// 开放大气的替身：风与热流出地图后被吸收，不撞外壁反射回场内
export function applySponge(): void {
  if (marginCells <= 0) return
  const m = <f64>marginCells
  for (let j = 1; j < ny - 1; j++) {
    const row = j * nx
    for (let i = 1; i <= marginCells; i++) {
      const s = (m - <f64>i) / m
      const kv = <f32>(spongeVelIn + (spongeVelOut - spongeVelIn) * s)
      const kt = <f32>(1 + (spongeTOut - 1) * s)
      const l = i + row
      const r = nx - 1 - i + row
      u[l] *= kv
      v[l] *= kv
      t[l] *= kt
      u[r] *= kv
      v[r] *= kv
      t[r] *= kt
    }
  }
  for (let j = 1; j <= marginCells; j++) {
    const row = j * nx
    const s = (m - <f64>j) / m
    const kv = <f32>(spongeVelIn + (spongeVelOut - spongeVelIn) * s)
    const kt = <f32>(1 + (spongeTOut - 1) * s)
    for (let i = marginCells + 1; i < nx - marginCells - 1; i++) {
      const idx = i + row
      u[idx] *= kv
      v[idx] *= kv
      t[idx] *= kt
    }
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
export function fieldFxU(): usize {
  return fxU.dataStart
}
export function fieldFxV(): usize {
  return fxV.dataStart
}
