/**
 * 即时模式三角形网格构建器（纯计算，无 DOM/WebGL 依赖，可无头测试）。
 * 顶点格式 x,y,r,g,b,a（颜色 0..1，非预乘 alpha）平铺于 Float32Array，渲染层只负责
 * 把 data.subarray(0, count * VERTEX_STRIDE) 以 TRIANGLES 上传绘制。逐顶点着色使每帧
 * 一次 draw call、图元可带精确透明度，线段宽度也不受 GL lineWidth 恒为 1 的限制。
 */
export const VERTEX_STRIDE = 6

/** 椭圆/圆弧展开的默认分段数（世界尺度下半径 0.3~12，20 段已足够圆滑） */
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

  /** 轴对齐矩形，y0 < y1 */
  rect(x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, a: number) {
    this.ensure(6)
    this.push(x0, y0, r, g, b, a)
    this.push(x1, y0, r, g, b, a)
    this.push(x0, y1, r, g, b, a)
    this.push(x1, y0, r, g, b, a)
    this.push(x1, y1, r, g, b, a)
    this.push(x0, y1, r, g, b, a)
  }

  /** 垂直渐变矩形：顶部颜色 → 底部颜色（逐顶点插值，等价两端色标的线性渐变） */
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

  /**
   * 线段 → 沿法线加宽的四边形（GL lineWidth 恒为 1，宽度必须几何化）。
   * 平头端：拖尾/轨迹由连续短段组成，段间缝隙可忽略；
   * round=true 时两端补半圆头（圆帽）——旗杆顶、虚线断点、折线轮廓的"首尾圆润"。
   */
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

  /** 斜接长度钳制系数（相对半宽）：过锐转角等效斜切，防尖刺 */
  private static MITER_LIMIT = 4

  /**
   * 折线描边：相邻线段在转角处按角平分线斜接（miter）相连，转角无缝。
   * 首尾平头、零长段跳过；要求各段法线同侧（地形等单调折线适用），折回轨迹仍用逐段 stroke。
   * pts 为 [x0,y0,x1,y1,...] 平铺，n 为浮点数个数（偶数）。
   */
  polyline(pts: Float32Array, n: number, w: number, r: number, g: number, b: number, a: number) {
    this.miter(pts, n, w, r, g, b, a)
  }

  /** 折线描边 + 逐顶点透明度（alpha[i] 对应 pts[2i] 处，段内线性渐变）：
   * 轨迹类线条按时间淡出时保持斜接无缝，避免按段平头四边形露角。 */
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
    // 上段状态：起点 (sx,sy)、起点端斜接向量 (mx,my)（已含半宽）、上段单位法线 (pnx,pny)
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
      // 本段起点 = 上段终点：斜接向量 = 两段法线之和（角平分线方向）
      let tx = pnx + nx
      let ty = pny + ny
      let fl = Math.sqrt(tx * tx + ty * ty)
      if (fl < 1e-6) {
        // 180° 折返：退化，按平头退避
        tx = nx
        ty = ny
        fl = 1
      } else {
        tx /= fl
        ty /= fl
        fl = hw / (pnx * tx + pny * ty) // = hw / cos(θ/2)
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

  /** 椭圆扇形填充：rot 为长轴旋转角（弧度）。rx = ry 时即正圆。 */
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

  /**
   * 径向渐变圆盘：中心 → 边缘逐顶点线性插值，与 createRadialGradient 两端色标
   * 视觉等价，免去每帧建渐变对象或烘焙位图。
   */
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

  /** 渐变圆盘环带采样的上一角度各环点 scratch（核环+3 环带环，零分配） */
  private gradRing = new Float32Array(8)

  /**
   * 径向渐变圆盘：中心到 solidFrac·radius 保持实色，之外沿 smoothstep
   * 曲线衰减到边缘色。环带按 1/3、2/3、边缘三环逐顶点插值——核缘与外缘
   * 切线连续（导数两头为 0），无线性渐变的"棱带"观感。
   * 模糊半径 = (1-solidFrac)·radius。
   */
  discGradCore(
    cx: number, cy: number, radius: number, seg: number, solidFrac: number,
    cr: number, cg: number, cb: number, ca: number,
    er: number, eg: number, eb: number, ea: number,
  ) {
    if (radius <= 0) return
    this.ensure(seg * 21)
    const inner = radius * solidFrac
    const band = radius - inner
    // 带内 1/3、2/3 两环的半径与 smoothstep 衰减系数（s²(3−2s)）
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
        // 核盘（中心→核环全实色）
        this.push(cx, cy, cr, cg, cb, ca)
        this.push(g[0], g[1], cr, cg, cb, ca)
        this.push(n0x, n0y, cr, cg, cb, ca)
        // 环带三段，每段两三角；顶点颜色按 smoothstep 插值
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

  /** 圆弧/虚线展开的采样点 scratch：按需扩容（最坏 = 弧线分段数 + 1） */
  private arcPts = new Float32Array(0)

  /** 圆弧描边：角度 a0 → a1（弧度，y 向下坐标系），线宽 w。
   * 相邻段斜接相连（转角无缝），弧线两端补圆头——虚线/圆弧首尾不再平头截断。 */
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

  /**
   * 虚线圆：on/off 为弧长（世界单位），从角度 0 起按周长铺排。
   * 小半径兜底：周长装不下 6 段时按比例收缩 on/off——保证至少 6 段，
   * 避免大间距小圆出现"碎块感"（虚线间距随半径动态适配）。
   */
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
