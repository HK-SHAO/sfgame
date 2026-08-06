// 顶点格式 x,y,r,g,b,a（0..1 非预乘）平铺；逐顶点颜色 → 整帧一次 draw call、精确逐图元透明度
export const VERTEX_STRIDE = 6

export const DISC_SEGMENTS = 20

export class MeshBatch {
  data: Float32Array
  count = 0

  constructor(capacity = 32768) {
    this.data = new Float32Array(capacity * VERTEX_STRIDE)
  }

  reset() {
    this.count = 0
  }

  private ensure(extra: number) {
    const need = (this.count + extra) * VERTEX_STRIDE
    if (need <= this.data.length) return
    let cap = this.data.length
    while (cap < need) cap *= 2
    const next = new Float32Array(cap)
    next.set(this.data)
    this.data = next
  }

  private push(x: number, y: number, r: number, g: number, b: number, a: number) {
    const o = this.count * VERTEX_STRIDE
    const d = this.data
    d[o] = x
    d[o + 1] = y
    d[o + 2] = r
    d[o + 3] = g
    d[o + 4] = b
    d[o + 5] = a
    this.count++
  }

  tri(
    x0: number, y0: number,
    x1: number, y1: number,
    x2: number, y2: number,
    r: number, g: number, b: number, a: number,
  ) {
    this.ensure(3)
    this.push(x0, y0, r, g, b, a)
    this.push(x1, y1, r, g, b, a)
    this.push(x2, y2, r, g, b, a)
  }

  rect(x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, a: number) {
    this.ensure(6)
    this.push(x0, y0, r, g, b, a)
    this.push(x1, y0, r, g, b, a)
    this.push(x0, y1, r, g, b, a)
    this.push(x1, y0, r, g, b, a)
    this.push(x1, y1, r, g, b, a)
    this.push(x0, y1, r, g, b, a)
  }

  rectVGrad(
    x0: number, y0: number, x1: number, y1: number,
    r0: number, g0: number, b0: number, a0: number,
    r1: number, g1: number, b1: number, a1: number,
  ) {
    this.ensure(6)
    this.push(x0, y0, r0, g0, b0, a0)
    this.push(x1, y0, r0, g0, b0, a0)
    this.push(x0, y1, r1, g1, b1, a1)
    this.push(x1, y0, r0, g0, b0, a0)
    this.push(x1, y1, r1, g1, b1, a1)
    this.push(x0, y1, r1, g1, b1, a1)
  }

  // GL lineWidth 多平台恒 1，线宽必须几何化
  stroke(x0: number, y0: number, x1: number, y1: number, w: number, r: number, g: number, b: number, a: number, round = false) {
    const dx = x1 - x0
    const dy = y1 - y0
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 1e-8) return
    const hw = w / 2 / len
    const nx = -dy * hw
    const ny = dx * hw
    this.ensure(6)
    this.push(x0 + nx, y0 + ny, r, g, b, a)
    this.push(x1 + nx, y1 + ny, r, g, b, a)
    this.push(x0 - nx, y0 - ny, r, g, b, a)
    this.push(x1 + nx, y1 + ny, r, g, b, a)
    this.push(x1 - nx, y1 - ny, r, g, b, a)
    this.push(x0 - nx, y0 - ny, r, g, b, a)
    if (round) {
      this.disc(x0, y0, w / 2, w / 2, 0, 8, r, g, b, a)
      this.disc(x1, y1, w / 2, w / 2, 0, 8, r, g, b, a)
    }
  }

  private static MITER_LIMIT = 4

  polyline(pts: Float32Array, n: number, w: number, r: number, g: number, b: number, a: number) {
    this.miter(pts, n, w, r, g, b, a)
  }

  polylineFade(pts: Float32Array, n: number, w: number, r: number, g: number, b: number, alpha: Float32Array) {
    this.miter(pts, n, w, r, g, b, alpha)
  }

  private miter(
    pts: Float32Array, n: number, w: number,
    r: number, g: number, b: number,
    alpha: Float32Array | number,
  ) {
    if (n < 4) return
    const hw = w / 2
    const limit = MeshBatch.MITER_LIMIT * hw
    const fade = typeof alpha !== 'number'
    let sx = 0
    let sy = 0
    let mx = 0
    let my = 0
    let pnx = 0
    let pny = 0
    let ready = false
    for (let i = 0; i + 3 < n; i += 2) {
      const ax = pts[i]
      const ay = pts[i + 1]
      const bx = pts[i + 2]
      const by = pts[i + 3]
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
      const a0 = fade ? alpha[i / 2 - 1] : alpha
      const a1 = fade ? alpha[i / 2] : alpha
      this.ensure(6)
      this.push(sx + mx, sy + my, r, g, b, a0)
      this.push(ax + ex, ay + ey, r, g, b, a1)
      this.push(sx - mx, sy - my, r, g, b, a0)
      this.push(ax + ex, ay + ey, r, g, b, a1)
      this.push(ax - ex, ay - ey, r, g, b, a1)
      this.push(sx - mx, sy - my, r, g, b, a0)
      sx = ax
      sy = ay
      mx = ex
      my = ey
      pnx = nx
      pny = ny
    }
    if (ready) {
      const bx = pts[n - 2]
      const by = pts[n - 1]
      const ex = pnx * hw
      const ey = pny * hw
      const a0 = fade ? alpha[(n - 4) / 2] : alpha
      const a1 = fade ? alpha[(n - 2) / 2] : alpha
      this.ensure(6)
      this.push(sx + mx, sy + my, r, g, b, a0)
      this.push(bx + ex, by + ey, r, g, b, a1)
      this.push(sx - mx, sy - my, r, g, b, a0)
      this.push(bx + ex, by + ey, r, g, b, a1)
      this.push(bx - ex, by - ey, r, g, b, a1)
      this.push(sx - mx, sy - my, r, g, b, a0)
    }
  }

  disc(
    cx: number, cy: number, rx: number, ry: number, rot: number, seg: number,
    r: number, g: number, b: number, a: number,
  ) {
    if (rx <= 0 || ry <= 0 || a <= 0) return
    this.ensure(seg * 3)
    const cos = Math.cos(rot)
    const sin = Math.sin(rot)
    let px = 0
    let py = 0
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * Math.PI * 2
      const ex = rx * Math.cos(th)
      const ey = ry * Math.sin(th)
      const qx = cx + ex * cos - ey * sin
      const qy = cy + ex * sin + ey * cos
      if (i > 0) this.tri(cx, cy, px, py, qx, qy, r, g, b, a)
      px = qx
      py = qy
    }
  }

  discGrad(
    cx: number, cy: number, radius: number, seg: number,
    cr: number, cg: number, cb: number, ca: number,
    er: number, eg: number, eb: number, ea: number,
  ) {
    if (radius <= 0) return
    this.ensure(seg * 3)
    let px = 0
    let py = 0
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * Math.PI * 2
      const qx = cx + radius * Math.cos(th)
      const qy = cy + radius * Math.sin(th)
      if (i > 0) {
        this.ensure(3)
        this.push(cx, cy, cr, cg, cb, ca)
        this.push(px, py, er, eg, eb, ea)
        this.push(qx, qy, er, eg, eb, ea)
      }
      px = qx
      py = qy
    }
  }

  private gradRing = new Float32Array(8)

  discGradCore(
    cx: number, cy: number, radius: number, seg: number, solidFrac: number,
    cr: number, cg: number, cb: number, ca: number,
    er: number, eg: number, eb: number, ea: number,
  ) {
    if (radius <= 0) return
    this.ensure(seg * 21)
    const inner = radius * solidFrac
    const band = radius - inner
    const r1 = inner + band / 3
    const r2 = inner + (band * 2) / 3
    const t1 = 7 / 27
    const t2 = 20 / 27
    const c1r = cr + (er - cr) * t1
    const c1g = cg + (eg - cg) * t1
    const c1b = cb + (eb - cb) * t1
    const c1a = ca + (ea - ca) * t1
    const c2r = cr + (er - cr) * t2
    const c2g = cg + (eg - cg) * t2
    const c2b = cb + (eb - cb) * t2
    const c2a = ca + (ea - ca) * t2
    const g = this.gradRing
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * Math.PI * 2
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
        this.push(cx, cy, cr, cg, cb, ca)
        this.push(g[0], g[1], cr, cg, cb, ca)
        this.push(n0x, n0y, cr, cg, cb, ca)
        this.push(g[0], g[1], cr, cg, cb, ca)
        this.push(g[2], g[3], c1r, c1g, c1b, c1a)
        this.push(n1x, n1y, c1r, c1g, c1b, c1a)
        this.push(g[0], g[1], cr, cg, cb, ca)
        this.push(n1x, n1y, c1r, c1g, c1b, c1a)
        this.push(n0x, n0y, cr, cg, cb, ca)
        this.push(g[2], g[3], c1r, c1g, c1b, c1a)
        this.push(g[4], g[5], c2r, c2g, c2b, c2a)
        this.push(n2x, n2y, c2r, c2g, c2b, c2a)
        this.push(g[2], g[3], c1r, c1g, c1b, c1a)
        this.push(n2x, n2y, c2r, c2g, c2b, c2a)
        this.push(n1x, n1y, c1r, c1g, c1b, c1a)
        this.push(g[4], g[5], c2r, c2g, c2b, c2a)
        this.push(g[6], g[7], er, eg, eb, ea)
        this.push(n3x, n3y, er, eg, eb, ea)
        this.push(g[4], g[5], c2r, c2g, c2b, c2a)
        this.push(n3x, n3y, er, eg, eb, ea)
        this.push(n2x, n2y, c2r, c2g, c2b, c2a)
      }
      g[0] = n0x
      g[1] = n0y
      g[2] = n1x
      g[3] = n1y
      g[4] = n2x
      g[5] = n2y
      g[6] = n3x
      g[7] = n3y
    }
  }

  ring(
    cx: number, cy: number, rx: number, ry: number, rot: number, seg: number, w: number,
    r: number, g: number, b: number, a: number,
  ) {
    if (rx <= 0 || ry <= 0 || a <= 0) return
    const cos = Math.cos(rot)
    const sin = Math.sin(rot)
    let px = 0
    let py = 0
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * Math.PI * 2
      const ex = rx * Math.cos(th)
      const ey = ry * Math.sin(th)
      const qx = cx + ex * cos - ey * sin
      const qy = cy + ex * sin + ey * cos
      if (i > 0) this.stroke(px, py, qx, qy, w, r, g, b, a)
      px = qx
      py = qy
    }
  }

  private arcPts = new Float32Array(0)

  arc(
    cx: number, cy: number, radius: number, a0: number, a1: number, seg: number, w: number,
    r: number, g: number, b: number, a: number,
  ) {
    if (radius <= 0 || a <= 0 || a1 === a0) return
    const n = seg + 1
    if (this.arcPts.length < n * 2) this.arcPts = new Float32Array(n * 2)
    const pts = this.arcPts
    for (let i = 0; i <= seg; i++) {
      const th = a0 + ((a1 - a0) * i) / seg
      pts[i * 2] = cx + radius * Math.cos(th)
      pts[i * 2 + 1] = cy + radius * Math.sin(th)
    }
    this.polyline(pts, n * 2, w, r, g, b, a)
    const hw = w / 2
    this.disc(pts[0], pts[1], hw, hw, 0, 8, r, g, b, a)
    this.disc(pts[seg * 2], pts[seg * 2 + 1], hw, hw, 0, 8, r, g, b, a)
  }

  dashRing(
    cx: number, cy: number, radius: number, on: number, off: number, w: number,
    r: number, g: number, b: number, a: number,
  ) {
    const circ = Math.PI * 2 * radius
    let period = on + off
    if (circ <= 0 || period <= 0) return
    if (circ < 6 * period) {
      const k = circ / (6 * period)
      on *= k
      off *= k
      period = on + off
    }
    let s = 0
    while (s < circ) {
      const segLen = Math.min(on, circ - s)
      const a0 = s / radius
      const a1 = (s + segLen) / radius
      const segs = Math.max(2, Math.ceil(segLen / 0.5))
      this.arc(cx, cy, radius, a0, a1, segs, w, r, g, b, a)
      s += period
    }
  }
}
