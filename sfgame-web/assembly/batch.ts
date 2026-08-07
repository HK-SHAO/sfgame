// 渲染顶点批数值内核（app/render/batch.ts 的 WASM 实现）：x,y,r,g,b,a 平铺，f64 中间量 → f32 存储。
// 静态容量 + stub runtime：实例化时定型、运行期零分配、memory.buffer 视图恒定；
// 容量溢出整体丢弃图元（最坏场景 ~10 万顶点，容量留 ~2 倍余量）。

export const VERTEX_STRIDE = 6
const CAPACITY = 196608
const PTS_CAP = 2048
const FADE_CAP = 1024
const MITER_LIMIT = 4

const data = new Float32Array(CAPACITY * VERTEX_STRIDE)
const ptsBuf = new Float32Array(PTS_CAP)
const fadeBuf = new Float32Array(FADE_CAP)
const gradRing = new Float32Array(8)

let count: i32 = 0

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

function stroke(
  x0: f64, y0: f64, x1: f64, y1: f64, w: f64,
  r: f64, g: f64, bl: f64, a: f64, round: bool,
): void {
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 1e-8) return
  if (count + (round ? 54 : 6) > CAPACITY) return
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
    disc(x0, y0, w / 2, w / 2, 0, 8, r, g, bl, a)
    disc(x1, y1, w / 2, w / 2, 0, 8, r, g, bl, a)
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

export function bPolyline(n: i32, w: f64, r: f64, g: f64, bl: f64, a: f64): void {
  miter(n, w, r, g, bl, a, false)
}

export function bPolylineFade(n: i32, w: f64, r: f64, g: f64, bl: f64): void {
  miter(n, w, r, g, bl, 0, true)
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

export function bDiscGradCore(
  cx: f64, cy: f64, radius: f64, seg: i32, solidFrac: f64,
  cr: f64, cg: f64, cb: f64, ca: f64,
  er: f64, eg: f64, eb: f64, ea: f64,
): void {
  if (radius <= 0) return
  if (count + seg * 21 > CAPACITY) return
  const inner = radius * solidFrac
  const band = radius - inner
  const r1 = inner + band / 3
  const r2 = inner + (band * 2) / 3
  // AS 整数字面量相除会截断为 0：须显式浮点
  const t1 = <f64>7 / 27
  const t2 = <f64>20 / 27
  const c1r = cr + (er - cr) * t1
  const c1g = cg + (eg - cg) * t1
  const c1b = cb + (eb - cb) * t1
  const c1a = ca + (ea - ca) * t1
  const c2r = cr + (er - cr) * t2
  const c2g = cg + (eg - cg) * t2
  const c2b = cb + (eb - cb) * t2
  const c2a = ca + (ea - ca) * t2
  const gd = gradRing
  for (let i = 0; i <= seg; i++) {
    const th = (<f64>i / <f64>seg) * Math.PI * 2
    const cos = Math.cos(th)
    const sin = Math.sin(th)
    const n0x = cx + inner * cos
    const n0y = cy + inner * sin
    const n1x = cx + r1 * cos
    const n1y = cy + r1 * sin
    const n2x = cx + r2 * cos
    const n2y = cy + r2 * sin
    const n3x = cx + radius * cos
    const n3y = cy + radius * sin
    if (i > 0) {
      push(cx, cy, cr, cg, cb, ca)
      push(<f64>gd[0], <f64>gd[1], cr, cg, cb, ca)
      push(n0x, n0y, cr, cg, cb, ca)
      push(<f64>gd[0], <f64>gd[1], cr, cg, cb, ca)
      push(<f64>gd[2], <f64>gd[3], c1r, c1g, c1b, c1a)
      push(n1x, n1y, c1r, c1g, c1b, c1a)
      push(<f64>gd[0], <f64>gd[1], cr, cg, cb, ca)
      push(n1x, n1y, c1r, c1g, c1b, c1a)
      push(n0x, n0y, cr, cg, cb, ca)
      push(<f64>gd[2], <f64>gd[3], c1r, c1g, c1b, c1a)
      push(<f64>gd[4], <f64>gd[5], c2r, c2g, c2b, c2a)
      push(n2x, n2y, c2r, c2g, c2b, c2a)
      push(<f64>gd[2], <f64>gd[3], c1r, c1g, c1b, c1a)
      push(n2x, n2y, c2r, c2g, c2b, c2a)
      push(n1x, n1y, c1r, c1g, c1b, c1a)
      push(<f64>gd[4], <f64>gd[5], c2r, c2g, c2b, c2a)
      push(<f64>gd[6], <f64>gd[7], er, eg, eb, ea)
      push(n3x, n3y, er, eg, eb, ea)
      push(<f64>gd[4], <f64>gd[5], c2r, c2g, c2b, c2a)
      push(n3x, n3y, er, eg, eb, ea)
      push(n2x, n2y, c2r, c2g, c2b, c2a)
    }
    gd[0] = <f32>n0x
    gd[1] = <f32>n0y
    gd[2] = <f32>n1x
    gd[3] = <f32>n1y
    gd[4] = <f32>n2x
    gd[5] = <f32>n2y
    gd[6] = <f32>n3x
    gd[7] = <f32>n3y
  }
}

export function bRing(
  cx: f64, cy: f64, rx: f64, ry: f64, rot: f64, seg: i32, w: f64,
  r: f64, g: f64, bl: f64, a: f64,
): void {
  if (rx <= 0 || ry <= 0 || a <= 0) return
  if (count + seg * 6 > CAPACITY) return
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
    if (i > 0) stroke(px, py, qx, qy, w, r, g, bl, a, false)
    px = qx
    py = qy
  }
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
  disc(<f64>ptsBuf[0], <f64>ptsBuf[1], hw, hw, 0, 8, r, g, bl, a)
  disc(<f64>ptsBuf[seg * 2], <f64>ptsBuf[seg * 2 + 1], hw, hw, 0, 8, r, g, bl, a)
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
