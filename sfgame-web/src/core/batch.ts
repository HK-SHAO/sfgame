/**
 * 彩色三角网格的即时模式构建器（纯计算，无 DOM/WebGL 依赖，可无头测试）。
 *
 * 顶点格式：x, y, r, g, b, a（颜色 0..1，非预乘 alpha），平铺于 Float32Array。
 * 渲染层（ui/gl.ts）只负责把 data.subarray(0, count * VERTEX_STRIDE) 上传 GPU
 * 并以 TRIANGLES 绘制——所有图元（矩形/线段/椭圆/弧/径向渐变）都在此展开为三角形。
 *
 * 设计动机：Canvas 2D 的描边/填充是"状态机 + 路径对象"，批量提交只能靠分桶近似
 * （透明度/颜色离散化）；逐顶点着色后每个图元可携带精确颜色与透明度，
 * 整帧一次 draw call，且线段宽度不再受 GL lineWidth 恒为 1 的平台限制。
 */

/** 每顶点浮点数个数：x, y, r, g, b, a */
export const VERTEX_STRIDE = 6

/** 椭圆/圆弧展开的默认分段数（世界尺度下半径 0.3~12，20 段已足够圆滑） */
export const DISC_SEGMENTS = 20

export class MeshBatch {
  /** 顶点数据平铺数组（容量 ≥ count * VERTEX_STRIDE） */
  data: Float32Array
  /** 已写入的顶点数 */
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

  /** 单色三角形 */
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

  /** 轴对齐矩形（2 三角形），y0 < y1 */
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
   * 线段 → 沿法线加宽的四边形（GL lineWidth 在多平台被钳制为 1，宽度必须几何化）。
   * 端点为平头（butt cap）：拖尾/轨迹由连续短段组成，段间缝隙可忽略。
   */
  stroke(x0: number, y0: number, x1: number, y1: number, w: number, r: number, g: number, b: number, a: number) {
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
  }

  /** 斜接长度钳制系数（相对半宽）：过锐转角等效斜切，防尖刺 */
  private static MITER_LIMIT = 4

  /**
   * 折线描边：相邻线段在转角处按角平分线斜接（miter）相连，转角无缝无缺口。
   * 首尾端点平头；零长段自动跳过。要求折线方向一致（各段法线同侧），
   * 适用于地形等单调折线；随机折回的轨迹仍用逐段 stroke。
   * pts 为 [x0,y0,x1,y1,...] 平铺，n 为浮点数个数（偶数）。
   */
  polyline(pts: Float32Array, n: number, w: number, r: number, g: number, b: number, a: number) {
    if (n < 4) return
    const hw = w / 2
    const limit = MeshBatch.MITER_LIMIT * hw
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
        // 首段：起点平头
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
      // 上段四边形：起点 ±(mx,my)，终点 ±(ex,ey)
      this.ensure(6)
      this.push(sx + mx, sy + my, r, g, b, a)
      this.push(ax + ex, ay + ey, r, g, b, a)
      this.push(sx - mx, sy - my, r, g, b, a)
      this.push(ax + ex, ay + ey, r, g, b, a)
      this.push(ax - ex, ay - ey, r, g, b, a)
      this.push(sx - mx, sy - my, r, g, b, a)
      sx = ax
      sy = ay
      mx = ex
      my = ey
      pnx = nx
      pny = ny
    }
    // 末段：终点平头
    if (ready) {
      const bx = pts[n - 2]
      const by = pts[n - 1]
      const ex = pnx * hw
      const ey = pny * hw
      this.ensure(6)
      this.push(sx + mx, sy + my, r, g, b, a)
      this.push(bx + ex, by + ey, r, g, b, a)
      this.push(sx - mx, sy - my, r, g, b, a)
      this.push(bx + ex, by + ey, r, g, b, a)
      this.push(bx - ex, by - ey, r, g, b, a)
      this.push(sx - mx, sy - my, r, g, b, a)
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
   * 径向渐变圆盘：中心色 → 边缘色逐顶点线性插值。
   * 与 Canvas 2D 两端色标（0 处 / 1 处）的 createRadialGradient 视觉等价，
   * 免去每帧建渐变对象或烘焙精灵位图。
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

  /** 椭圆描边（分段 stroke 逼近），线宽 w */
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

  /** 圆弧描边：角度 a0 → a1（弧度，y 向下坐标系），线宽 w */
  arc(
    cx: number, cy: number, radius: number, a0: number, a1: number, seg: number, w: number,
    r: number, g: number, b: number, a: number,
  ) {
    if (radius <= 0 || a <= 0 || a1 === a0) return
    let px = cx + radius * Math.cos(a0)
    let py = cy + radius * Math.sin(a0)
    for (let i = 1; i <= seg; i++) {
      const th = a0 + ((a1 - a0) * i) / seg
      const qx = cx + radius * Math.cos(th)
      const qy = cy + radius * Math.sin(th)
      this.stroke(px, py, qx, qy, w, r, g, b, a)
      px = qx
      py = qy
    }
  }

  /** 虚线圆：on/off 为弧长（世界单位），从角度 0 起按周长铺排 */
  dashRing(
    cx: number, cy: number, radius: number, on: number, off: number, w: number,
    r: number, g: number, b: number, a: number,
  ) {
    const circ = Math.PI * 2 * radius
    const period = on + off
    if (circ <= 0 || period <= 0) return
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
