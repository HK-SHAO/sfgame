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
