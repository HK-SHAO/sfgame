// 渲染顶点批数值内核（app/render/batch.ts 的 WASM 实现）：x,y,r,g,b,a 平铺，f64 中间量 → f32 存储。
// 静态容量 + stub runtime：实例化时定型、运行期零分配、memory.buffer 视图恒定；
// 容量溢出逐图元检查丢弃（地形逐格降级，其余图元整体丢弃，绝不写越界）。

export const VERTEX_STRIDE = 6
// 最坏帧 ≈ 地形 ~11 万 + 示踪 ~7 万 + 其余 ~1 万：留足余量，溢出由逐图元检查优雅降级（取 12 整倍便于恰好写满）
const CAPACITY = 262152
const PTS_CAP = 2048
const FADE_CAP = 1024
const MITER_LIMIT = 4
// 示踪粒子批量缓冲：定长记录 [r,g,b,np,headA] + 每点 [x,y,fade]，宿主直写后单次调用 tessellate
const TRACER_CAP = 400
const TRACER_MAX_PTS = 25
const TRACER_STRIDE = 5 + TRACER_MAX_PTS * 3
// 地形 SDF 场容量（格点数 nx×ny）：与流体最大网格同上限，宿主每关上传一次
const TG_CAP = 19200

const data = new Float32Array(CAPACITY * VERTEX_STRIDE)
const ptsBuf = new Float32Array(PTS_CAP)
const fadeBuf = new Float32Array(FADE_CAP)
const tracerBuf = new Float32Array(TRACER_CAP * TRACER_STRIDE)
// 地形固体填充：格心 SDF 场 + marching squares 多边形刮板（凸多边形 ≤6 点）
const tgField = new Float32Array(TG_CAP)
const tgCX = new Float64Array(4)
const tgCY = new Float64Array(4)
const tgCD = new Float64Array(4)
const tgCS = new Uint8Array(4)
const polyX = new Float64Array(6)
const polyY = new Float64Array(6)
const polyD = new Float64Array(6)

let count: i32 = 0
let tgNx: i32 = 0
let tgNy: i32 = 0
let tgX0: f64 = 0
let tgY0: f64 = 0
let tgCell: f64 = 1
// 配色：地表色（d=0）随入地深度指数渐近混向深处色（渲染常量由宿主传入）
let tgSr: f64 = 0
let tgSg: f64 = 0
let tgSb: f64 = 0
let tgDr: f64 = 0
let tgDg: f64 = 0
let tgDb: f64 = 0
let tgLen: f64 = 1

export function bCapacity(): i32 {
  return CAPACITY
}
export function bPtsCap(): i32 {
  return PTS_CAP
}
export function bFadeCap(): i32 {
  return FADE_CAP
}
export function bData(): usize {
  return data.dataStart
}
export function bPtsBuf(): usize {
  return ptsBuf.dataStart
}
export function bFadeBuf(): usize {
  return fadeBuf.dataStart
}
export function bTracerBuf(): usize {
  return tracerBuf.dataStart
}
export function bTracerCap(): i32 {
  return TRACER_CAP
}
export function bTracerStride(): i32 {
  return TRACER_STRIDE
}
export function bCount(): i32 {
  return count
}
export function bReset(): void {
  count = 0
}

function push(x: f64, y: f64, r: f64, g: f64, bl: f64, a: f64): void {
  const o = count * VERTEX_STRIDE
  data[o] = <f32>x
  data[o + 1] = <f32>y
  data[o + 2] = <f32>r
  data[o + 3] = <f32>g
  data[o + 4] = <f32>bl
  data[o + 5] = <f32>a
  count++
}

export function bTri(
  x0: f64, y0: f64, x1: f64, y1: f64, x2: f64, y2: f64,
  r: f64, g: f64, bl: f64, a: f64,
): void {
  if (count + 3 > CAPACITY) return
  push(x0, y0, r, g, bl, a)
  push(x1, y1, r, g, bl, a)
  push(x2, y2, r, g, bl, a)
}

export function bRect(
  x0: f64, y0: f64, x1: f64, y1: f64,
  r: f64, g: f64, bl: f64, a: f64,
): void {
  if (count + 6 > CAPACITY) return
  push(x0, y0, r, g, bl, a)
  push(x1, y0, r, g, bl, a)
  push(x0, y1, r, g, bl, a)
  push(x1, y0, r, g, bl, a)
  push(x1, y1, r, g, bl, a)
  push(x0, y1, r, g, bl, a)
}

export function bRectVGrad(
  x0: f64, y0: f64, x1: f64, y1: f64,
  r0: f64, g0: f64, b0: f64, a0: f64,
  r1: f64, g1: f64, b1: f64, a1: f64,
): void {
  if (count + 6 > CAPACITY) return
  push(x0, y0, r0, g0, b0, a0)
  push(x1, y0, r0, g0, b0, a0)
  push(x0, y1, r1, g1, b1, a1)
  push(x1, y0, r0, g0, b0, a0)
  push(x1, y1, r1, g1, b1, a1)
  push(x0, y1, r1, g1, b1, a1)
}

function disc(
  cx: f64, cy: f64, rx: f64, ry: f64, rot: f64, seg: i32,
  r: f64, g: f64, bl: f64, a: f64,
): void {
  if (rx <= 0 || ry <= 0 || a <= 0) return
  if (count + seg * 3 > CAPACITY) return
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  let px: f64 = 0
  let py: f64 = 0
  for (let i = 0; i <= seg; i++) {
    const th = (<f64>i / <f64>seg) * Math.PI * 2
    const ex = rx * Math.cos(th)
    const ey = ry * Math.sin(th)
    const qx = cx + ex * cos - ey * sin
    const qy = cy + ex * sin + ey * cos
    if (i > 0) {
      push(cx, cy, r, g, bl, a)
      push(px, py, r, g, bl, a)
      push(qx, qy, r, g, bl, a)
    }
    px = qx
    py = qy
  }
}

export function bDisc(
  cx: f64, cy: f64, rx: f64, ry: f64, rot: f64, seg: i32,
  r: f64, g: f64, bl: f64, a: f64,
): void {
  disc(cx, cy, rx, ry, rot, seg, r, g, bl, a)
}

// 半圆盘（π 扇）：圆润端帽专用——整圆盘与线段带重叠，半透明双重混合使端头发深；
// 半圆盘恰好补在线段带之外的延长区，零重叠、alpha 均匀
function halfDisc(cx: f64, cy: f64, r: f64, phi: f64, seg: i32, cr: f64, cg: f64, cb: f64, a: f64): void {
  if (r <= 0 || a <= 0) return
  if (count + seg * 3 > CAPACITY) return
  let px: f64 = 0
  let py: f64 = 0
  for (let i = 0; i <= seg; i++) {
    const th = phi - Math.PI / 2 + (Math.PI * <f64>i) / <f64>seg
    const qx = cx + r * Math.cos(th)
    const qy = cy + r * Math.sin(th)
    if (i > 0) {
      push(cx, cy, cr, cg, cb, a)
      push(px, py, cr, cg, cb, a)
      push(qx, qy, cr, cg, cb, a)
    }
    px = qx
    py = qy
  }
}

function stroke(
  x0: f64, y0: f64, x1: f64, y1: f64, w: f64,
  r: f64, g: f64, bl: f64, a: f64, round: bool,
): void {
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 1e-8) return
  // 圆头 = 四边形带 + 两端朝外半圆盘（6 + 2×18 顶点，互不重叠）
  if (count + (round ? 42 : 6) > CAPACITY) return
  const hw = w / 2 / len
  const nx = -dy * hw
  const ny = dx * hw
  push(x0 + nx, y0 + ny, r, g, bl, a)
  push(x1 + nx, y1 + ny, r, g, bl, a)
  push(x0 - nx, y0 - ny, r, g, bl, a)
  push(x1 + nx, y1 + ny, r, g, bl, a)
  push(x1 - nx, y1 - ny, r, g, bl, a)
  push(x0 - nx, y0 - ny, r, g, bl, a)
  if (round) {
    const phi = Math.atan2(dy, dx)
    halfDisc(x1, y1, w / 2, phi, 6, r, g, bl, a)
    halfDisc(x0, y0, w / 2, phi + Math.PI, 6, r, g, bl, a)
  }
}

export function bStroke(
  x0: f64, y0: f64, x1: f64, y1: f64, w: f64,
  r: f64, g: f64, bl: f64, a: f64, round: bool,
): void {
  stroke(x0, y0, x1, y1, w, r, g, bl, a, round)
}

// pts/fade 由宿主写入 ptsBuf/fadeBuf 后调用；n 为 float 个数（点数 × 2）
function miter(n: i32, w: f64, r: f64, g: f64, bl: f64, baseA: f64, fade: bool): void {
  if (n < 4) return
  if (count + 3 * n > CAPACITY) return
  const hw = w / 2
  const limit = <f64>MITER_LIMIT * hw
  let sx: f64 = 0
  let sy: f64 = 0
  let mx: f64 = 0
  let my: f64 = 0
  let pnx: f64 = 0
  let pny: f64 = 0
  let ready = false
  for (let i = 0; i + 3 < n; i += 2) {
    const ax = <f64>ptsBuf[i]
    const ay = <f64>ptsBuf[i + 1]
    const bx = <f64>ptsBuf[i + 2]
    const by = <f64>ptsBuf[i + 3]
    const dx = bx - ax
    const dy = by - ay
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 1e-8) continue
    const nx = -dy / len
    const ny = dx / len
    if (!ready) {
      sx = ax
      sy = ay
      mx = nx * hw
      my = ny * hw
      pnx = nx
      pny = ny
      ready = true
      continue
    }
    let tx = pnx + nx
    let ty = pny + ny
    let fl = Math.sqrt(tx * tx + ty * ty)
    if (fl < 1e-6) {
      tx = nx
      ty = ny
      fl = 1
    } else {
      tx /= fl
      ty /= fl
      fl = hw / (pnx * tx + pny * ty)
      if (fl > limit) fl = limit
    }
    const ex = tx * fl
    const ey = ty * fl
    const a0 = fade ? <f64>fadeBuf[i / 2 - 1] : baseA
    const a1 = fade ? <f64>fadeBuf[i / 2] : baseA
    push(sx + mx, sy + my, r, g, bl, a0)
    push(ax + ex, ay + ey, r, g, bl, a1)
    push(sx - mx, sy - my, r, g, bl, a0)
    push(ax + ex, ay + ey, r, g, bl, a1)
    push(ax - ex, ay - ey, r, g, bl, a1)
    push(sx - mx, sy - my, r, g, bl, a0)
    sx = ax
    sy = ay
    mx = ex
    my = ey
    pnx = nx
    pny = ny
  }
  if (ready) {
    const bx = <f64>ptsBuf[n - 2]
    const by = <f64>ptsBuf[n - 1]
    const ex = pnx * hw
    const ey = pny * hw
    const a0 = fade ? <f64>fadeBuf[(n - 4) / 2] : baseA
    const a1 = fade ? <f64>fadeBuf[(n - 2) / 2] : baseA
    push(sx + mx, sy + my, r, g, bl, a0)
    push(bx + ex, by + ey, r, g, bl, a1)
    push(sx - mx, sy - my, r, g, bl, a0)
    push(bx + ex, by + ey, r, g, bl, a1)
    push(bx - ex, by - ey, r, g, bl, a1)
    push(sx - mx, sy - my, r, g, bl, a0)
  }
}

export function bPolylineFade(n: i32, w: f64, r: f64, g: f64, bl: f64): void {
  miter(n, w, r, g, bl, 0, true)
}

// 地形固体填充（marching squares）：宿主每关上传格心 SDF 场，每帧对可视格做等值线切割——
// 轮廓 = 格内线性插值的 d=0 线，矢量级锐利（无软边 alpha）；颜色按入地深度指数渐近（表面最陡、深处趋缓，视觉自然）。
// 越界格索引钳至边缘列 = 地形自然延展；鞍点（对角双固体）以格心均值消歧
function pushTg(x: f64, y: f64, d: f64): void {
  const depth = d < 0 ? -d : 0
  const k = 1 - Math.exp(-depth / tgLen)
  push(x, y, tgSr + (tgDr - tgSr) * k, tgSg + (tgDg - tgSg) * k, tgSb + (tgDb - tgSb) * k, 1)
}

export function bTerrainFieldBuf(): usize {
  return tgField.dataStart
}
export function bTerrainFieldCap(): i32 {
  return TG_CAP
}
export function bTerrainField(
  nx: i32, ny: i32, x0: f64, y0: f64, cell: f64,
  sr: f64, sg: f64, sb: f64, dr: f64, dg: f64, db: f64, depthLen: f64,
): i32 {
  if (nx < 2 || ny < 2 || nx * ny > TG_CAP || depthLen <= 0) return 1
  tgNx = nx
  tgNy = ny
  tgX0 = x0
  tgY0 = y0
  tgCell = cell
  tgSr = sr
  tgSg = sg
  tgSb = sb
  tgDr = dr
  tgDg = dg
  tgDb = db
  tgLen = depthLen
  return 0
}
export function bTerrainDraw(i0: i32, j0: i32, i1: i32, j1: i32): void {
  if (tgNx < 2 || tgNy < 2) return
  if (i1 <= i0 || j1 <= j0) return
  const mx = tgNx - 1
  const my = tgNy - 1
  for (let j = j0; j < j1; j++) {
    let bj = j
    if (bj < 0) bj = 0
    else if (bj > my) bj = my
    let bj1 = j + 1
    if (bj1 < 0) bj1 = 0
    else if (bj1 > my) bj1 = my
    const y0 = tgY0 + <f64>j * tgCell
    const y1 = y0 + tgCell
    for (let i = i0; i < i1; i++) {
      // 逐格预算（每格至多 12 顶点）：容量临界时优雅截断，而非整批丢弃导致地形闪烁/消失
      if (count + 12 > CAPACITY) return
      let ai = i
      if (ai < 0) ai = 0
      else if (ai > mx) ai = mx
      let ai1 = i + 1
      if (ai1 < 0) ai1 = 0
      else if (ai1 > mx) ai1 = mx
      const d00 = <f64>tgField[bj * tgNx + ai]
      const d10 = <f64>tgField[bj * tgNx + ai1]
      const d11 = <f64>tgField[bj1 * tgNx + ai1]
      const d01 = <f64>tgField[bj1 * tgNx + ai]
      const s00 = d00 <= 0
      const s10 = d10 <= 0
      const s11 = d11 <= 0
      const s01 = d01 <= 0
      const n = (s00 ? 1 : 0) + (s10 ? 1 : 0) + (s11 ? 1 : 0) + (s01 ? 1 : 0)
      if (n == 0) continue
      const x0 = tgX0 + <f64>i * tgCell
      const x1 = x0 + tgCell
      if (n == 4) {
        pushTg(x0, y0, d00)
        pushTg(x1, y0, d10)
        pushTg(x0, y1, d01)
        pushTg(x1, y0, d10)
        pushTg(x1, y1, d11)
        pushTg(x0, y1, d01)
        continue
      }
      // 鞍点且格心为空气：两块固体互不相连，拆成两个独立三角形（行走法会错误连通）
      if (n == 2 && s00 == s11 && d00 + d10 + d01 + d11 > 0) {
        const topX = x0 + tgCell * (d00 / (d00 - d10))
        const rightY = y0 + tgCell * (d10 / (d10 - d11))
        const botX = x1 - tgCell * (d11 / (d11 - d01))
        const leftY = y1 - tgCell * (d01 / (d01 - d00))
        if (s00) {
          pushTg(x0, y0, d00)
          pushTg(topX, y0, 0)
          pushTg(x0, leftY, 0)
          pushTg(x1, y1, d11)
          pushTg(x1, rightY, 0)
          pushTg(botX, y1, 0)
        } else {
          pushTg(x1, y0, d10)
          pushTg(topX, y0, 0)
          pushTg(x1, rightY, 0)
          pushTg(x0, y1, d01)
          pushTg(x0, leftY, 0)
          pushTg(botX, y1, 0)
        }
        continue
      }
      // 常规：绕格行走（TL→TR→BR→BL）收集固体角与交点成凸多边形，扇形化
      tgCX[0] = x0; tgCY[0] = y0; tgCD[0] = d00; tgCS[0] = s00 ? 1 : 0
      tgCX[1] = x1; tgCY[1] = y0; tgCD[1] = d10; tgCS[1] = s10 ? 1 : 0
      tgCX[2] = x1; tgCY[2] = y1; tgCD[2] = d11; tgCS[2] = s11 ? 1 : 0
      tgCX[3] = x0; tgCY[3] = y1; tgCD[3] = d01; tgCS[3] = s01 ? 1 : 0
      let m = 0
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) & 3
        if (tgCS[k]) {
          polyX[m] = tgCX[k]
          polyY[m] = tgCY[k]
          polyD[m] = tgCD[k]
          m++
        }
        if (tgCS[k] != tgCS[k2]) {
          const da = tgCD[k]
          const tt = da / (da - tgCD[k2])
          polyX[m] = tgCX[k] + (tgCX[k2] - tgCX[k]) * tt
          polyY[m] = tgCY[k] + (tgCY[k2] - tgCY[k]) * tt
          polyD[m] = 0
          m++
        }
      }
      for (let k = 1; k + 1 < m; k++) {
        pushTg(polyX[0], polyY[0], polyD[0])
        pushTg(polyX[k], polyY[k], polyD[k])
        pushTg(polyX[k + 1], polyY[k + 1], polyD[k + 1])
      }
    }
  }
}

// 示踪粒子批量：宿主把可见粒子写入 tracerBuf（定长记录），单调用完成全部拖尾 tessellate + 头部圆盘，
// 替代逐粒子 polylineFade + disc（每帧约 800 次跨界 → 1 次）
export function bTracers(count: i32, w: f64, headR: f64): void {
  for (let i = 0; i < count && i < TRACER_CAP; i++) {
    const off = i * TRACER_STRIDE
    const r = <f64>tracerBuf[off]
    const g = <f64>tracerBuf[off + 1]
    const bl = <f64>tracerBuf[off + 2]
    const np = <i32>tracerBuf[off + 3]
    const headA = <f64>tracerBuf[off + 4]
    if (np <= 0) continue
    if (np >= 2) {
      for (let k = 0; k < np; k++) {
        ptsBuf[k * 2] = tracerBuf[off + 5 + k * 3]
        ptsBuf[k * 2 + 1] = tracerBuf[off + 6 + k * 3]
        fadeBuf[k] = tracerBuf[off + 7 + k * 3]
      }
      miter(np * 2, w, r, g, bl, 0, true)
    }
    const hx = <f64>tracerBuf[off + 5 + (np - 1) * 3]
    const hy = <f64>tracerBuf[off + 6 + (np - 1) * 3]
    disc(hx, hy, headR, headR, 0, 10, r, g, bl, headA)
  }
}

export function bDiscGrad(
  cx: f64, cy: f64, radius: f64, seg: i32,
  cr: f64, cg: f64, cb: f64, ca: f64,
  er: f64, eg: f64, eb: f64, ea: f64,
): void {
  if (radius <= 0) return
  if (count + seg * 3 > CAPACITY) return
  let px: f64 = 0
  let py: f64 = 0
  for (let i = 0; i <= seg; i++) {
    const th = (<f64>i / <f64>seg) * Math.PI * 2
    const qx = cx + radius * Math.cos(th)
    const qy = cy + radius * Math.sin(th)
    if (i > 0) {
      push(cx, cy, cr, cg, cb, ca)
      push(px, py, er, eg, eb, ea)
      push(qx, qy, er, eg, eb, ea)
    }
    px = qx
    py = qy
  }
}

export function bRing(
  cx: f64, cy: f64, rx: f64, ry: f64, rot: f64, seg: i32, w: f64,
  r: f64, g: f64, bl: f64, a: f64,
): void {
  if (rx <= 0 || ry <= 0 || a <= 0) return
  const n = seg + 1
  if (n * 2 > PTS_CAP) return
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  for (let i = 0; i <= seg; i++) {
    const th = (<f64>i / <f64>seg) * Math.PI * 2
    const ex = rx * Math.cos(th)
    const ey = ry * Math.sin(th)
    ptsBuf[i * 2] = <f32>(cx + ex * cos - ey * sin)
    ptsBuf[i * 2 + 1] = <f32>(cy + ex * sin + ey * cos)
  }
  // 闭环折线（末点回首点）miter 接头：旧逐段 stroke 在接头处双重混合发深且有角度缺口
  miter(n * 2, w, r, g, bl, a, false)
}

// 与 polyline 复用 ptsBuf：调用方不得在 arc 期间改写入参缓冲（单线程天然成立）
function arc(
  cx: f64, cy: f64, radius: f64, a0: f64, a1: f64, seg: i32, w: f64,
  r: f64, g: f64, bl: f64, a: f64,
): void {
  if (radius <= 0 || a <= 0 || a1 == a0) return
  const n = seg + 1
  if (n * 2 > PTS_CAP) return
  for (let i = 0; i <= seg; i++) {
    const th = a0 + ((a1 - a0) * <f64>i) / <f64>seg
    ptsBuf[i * 2] = <f32>(cx + radius * Math.cos(th))
    ptsBuf[i * 2 + 1] = <f32>(cy + radius * Math.sin(th))
  }
  miter(n * 2, w, r, g, bl, a, false)
  const hw = w / 2
  // 端帽 = 沿切线朝外的半圆盘（与折线带零重叠）：旧整圆盘与末段双混使虚线每节两端发深
  const i1 = seg * 2
  const phi0 = Math.atan2(<f64>ptsBuf[1] - <f64>ptsBuf[3], <f64>ptsBuf[0] - <f64>ptsBuf[2])
  const phi1 = Math.atan2(<f64>ptsBuf[i1 + 1] - <f64>ptsBuf[i1 - 1], <f64>ptsBuf[i1] - <f64>ptsBuf[i1 - 2])
  halfDisc(<f64>ptsBuf[0], <f64>ptsBuf[1], hw, phi0, 6, r, g, bl, a)
  halfDisc(<f64>ptsBuf[i1], <f64>ptsBuf[i1 + 1], hw, phi1, 6, r, g, bl, a)
}

export function bArc(
  cx: f64, cy: f64, radius: f64, a0: f64, a1: f64, seg: i32, w: f64,
  r: f64, g: f64, bl: f64, a: f64,
): void {
  arc(cx, cy, radius, a0, a1, seg, w, r, g, bl, a)
}

export function bDashRing(
  cx: f64, cy: f64, radius: f64, on: f64, off: f64, w: f64,
  r: f64, g: f64, bl: f64, a: f64,
): void {
  const circ = Math.PI * 2 * radius
  let onLen = on
  let offLen = off
  let period = onLen + offLen
  if (circ <= 0 || period <= 0) return
  if (circ < 6 * period) {
    const k = circ / (6 * period)
    onLen *= k
    offLen *= k
    period = onLen + offLen
  }
  let s: f64 = 0
  while (s < circ) {
    const segLen = Math.min(onLen, circ - s)
    const ang0 = s / radius
    const ang1 = (s + segLen) / radius
    let segs = <i32>Math.ceil(segLen / 0.5)
    if (segs < 2) segs = 2
    arc(cx, cy, radius, ang0, ang1, segs, w, r, g, bl, a)
    s += period
  }
}
