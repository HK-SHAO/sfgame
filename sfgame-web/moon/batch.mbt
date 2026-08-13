// 渲染顶点批数值内核（assembly/batch.ts 的 Moonbit 同构移植）：
// x,y,r,g,b,a 平铺，f64 中间量 → f32 存储；静态容量、运行期零分配，容量溢出逐图元丢弃。
// 渲染几何非混沌路径，三角函数按 Moonbit 标准库实现（与 AS 的 libm 最低位可能不同，视觉等价）。

///|
let vertex_stride : Int = 6
// 最坏帧 ≈ 地形 ~11 万 + 示踪 ~7 万 + 其余 ~1 万：留足余量，取 12 整倍便于恰好写满

///|
let capacity : Int = 262152

///|
let pts_cap : Int = 2048

///|
let fade_cap : Int = 1024

///|
let miter_limit : Int = 4
// 示踪粒子批量缓冲：定长记录 [r,g,b,np,headA] + 每点 [x,y,fade]，宿主直写后单次调用 tessellate

///|
let tracer_cap : Int = 400

///|
let tracer_max_pts : Int = 25

///|
let tracer_stride : Int = 5 + tracer_max_pts * 3
// 地形 SDF 场容量（格点数 nx×ny）：与流体最大网格同上限

///|
let tg_cap : Int = 19200

///|
let data : FixedArray[Float] = FixedArray::make(capacity * vertex_stride, 0.0)

///|
let pts_buf : FixedArray[Float] = FixedArray::make(pts_cap, 0.0)

///|
let fade_buf : FixedArray[Float] = FixedArray::make(fade_cap, 0.0)

///|
let tracer_buf : FixedArray[Float] = FixedArray::make(
  tracer_cap * tracer_stride,
  0.0,
)
// 地形固体填充：格心 SDF 场 + marching squares 多边形刮板（凸多边形 ≤6 点）

///|
let tg_field : FixedArray[Float] = FixedArray::make(tg_cap, 0.0)
// 地形烘焙输出缓冲（独立于主批）：静态几何一次烘焙，每帧免重切 + 免上传
// 容量 = 最坏全实体 19200×6 顶点（与主批"地形 ~11 万"同级预算，超限逐格截断）

///|
let tg_out_cap : Int = 115200

///|
let tg_data : FixedArray[Float] = FixedArray::make(tg_out_cap * vertex_stride, 0.0)

///|
let tg_cx : FixedArray[Double] = FixedArray::make(4, 0.0)

///|
let tg_cy : FixedArray[Double] = FixedArray::make(4, 0.0)

///|
let tg_cd : FixedArray[Double] = FixedArray::make(4, 0.0)

///|
let tg_cs : FixedArray[Byte] = FixedArray::make(4, b'\x00')

///|
let poly_x : FixedArray[Double] = FixedArray::make(6, 0.0)

///|
let poly_y : FixedArray[Double] = FixedArray::make(6, 0.0)

///|
let poly_d : FixedArray[Double] = FixedArray::make(6, 0.0)

///|
priv struct BState {
  mut count : Int
  mut tg_nx : Int
  mut tg_ny : Int
  mut tg_x0 : Double
  mut tg_y0 : Double
  mut tg_cell : Double
  // 配色：地表色（d=0）随入地深度指数渐近混向深处色（渲染常量由宿主传入）
  mut tg_sr : Double
  mut tg_sg : Double
  mut tg_sb : Double
  mut tg_dr : Double
  mut tg_dg : Double
  mut tg_db : Double
  mut tg_len : Double
  mut tg_count : Int
}

///|
let bs : BState = BState::{
  count: 0,
  tg_nx: 0,
  tg_ny: 0,
  tg_x0: 0.0,
  tg_y0: 0.0,
  tg_cell: 1.0,
  tg_sr: 0.0,
  tg_sg: 0.0,
  tg_sb: 0.0,
  tg_dr: 0.0,
  tg_dg: 0.0,
  tg_db: 0.0,
  tg_len: 1.0,
  tg_count: 0,
}

///|
#export_name("bCapacity")
pub fn b_capacity() -> Int {
  capacity
}

///|
#export_name("bPtsCap")
pub fn b_pts_cap() -> Int {
  pts_cap
}

///|
#export_name("bFadeCap")
pub fn b_fade_cap() -> Int {
  fade_cap
}

///|
#export_name("bData")
pub fn b_data() -> Int {
  addr_of_f32(data)
}

///|
#export_name("bPtsBuf")
pub fn b_pts_buf() -> Int {
  addr_of_f32(pts_buf)
}

///|
#export_name("bFadeBuf")
pub fn b_fade_buf() -> Int {
  addr_of_f32(fade_buf)
}

///|
#export_name("bTracerBuf")
pub fn b_tracer_buf() -> Int {
  addr_of_f32(tracer_buf)
}

///|
#export_name("bTracerCap")
pub fn b_tracer_cap() -> Int {
  tracer_cap
}

///|
#export_name("bTracerStride")
pub fn b_tracer_stride() -> Int {
  tracer_stride
}

///|
#export_name("bCount")
pub fn b_count() -> Int {
  bs.count
}

///|
#export_name("bReset")
pub fn b_reset() -> Unit {
  bs.count = 0
}

///|
fn push(
  x : Double,
  y : Double,
  r : Double,
  g : Double,
  bl : Double,
  a : Double,
) -> Unit {
  let o = bs.count * vertex_stride
  data[o] = Float::from_double(x)
  data[o + 1] = Float::from_double(y)
  data[o + 2] = Float::from_double(r)
  data[o + 3] = Float::from_double(g)
  data[o + 4] = Float::from_double(bl)
  data[o + 5] = Float::from_double(a)
  bs.count = bs.count + 1
}

///|
#export_name("bTri")
pub fn b_tri(
  x0 : Double,
  y0 : Double,
  x1 : Double,
  y1 : Double,
  x2 : Double,
  y2 : Double,
  r : Double,
  g : Double,
  bl : Double,
  a : Double,
) -> Unit {
  if bs.count + 3 > capacity {
    return
  }
  push(x0, y0, r, g, bl, a)
  push(x1, y1, r, g, bl, a)
  push(x2, y2, r, g, bl, a)
}

///|
#export_name("bRect")
pub fn b_rect(
  x0 : Double,
  y0 : Double,
  x1 : Double,
  y1 : Double,
  r : Double,
  g : Double,
  bl : Double,
  a : Double,
) -> Unit {
  if bs.count + 6 > capacity {
    return
  }
  push(x0, y0, r, g, bl, a)
  push(x1, y0, r, g, bl, a)
  push(x0, y1, r, g, bl, a)
  push(x1, y0, r, g, bl, a)
  push(x1, y1, r, g, bl, a)
  push(x0, y1, r, g, bl, a)
}

///|
#export_name("bRectVGrad")
pub fn b_rect_vgrad(
  x0 : Double,
  y0 : Double,
  x1 : Double,
  y1 : Double,
  r0 : Double,
  g0 : Double,
  b0 : Double,
  a0 : Double,
  r1 : Double,
  g1 : Double,
  b1 : Double,
  a1 : Double,
) -> Unit {
  if bs.count + 6 > capacity {
    return
  }
  push(x0, y0, r0, g0, b0, a0)
  push(x1, y0, r0, g0, b0, a0)
  push(x0, y1, r1, g1, b1, a1)
  push(x1, y0, r0, g0, b0, a0)
  push(x1, y1, r1, g1, b1, a1)
  push(x0, y1, r1, g1, b1, a1)
}

///|
fn disc(
  cx : Double,
  cy : Double,
  rx : Double,
  ry : Double,
  rot : Double,
  seg : Int,
  r : Double,
  g : Double,
  bl : Double,
  a : Double,
) -> Unit {
  if rx <= 0.0 || ry <= 0.0 || a <= 0.0 {
    return
  }
  if bs.count + seg * 3 > capacity {
    return
  }
  let cos = @math.cos(rot)
  let sin = @math.sin(rot)
  let mut px = 0.0
  let mut py = 0.0
  for i in 0..<(seg + 1) {
    let th = i.to_double() / seg.to_double() * @math.PI * 2.0
    let ex = rx * @math.cos(th)
    let ey = ry * @math.sin(th)
    let qx = cx + ex * cos - ey * sin
    let qy = cy + ex * sin + ey * cos
    if i > 0 {
      push(cx, cy, r, g, bl, a)
      push(px, py, r, g, bl, a)
      push(qx, qy, r, g, bl, a)
    }
    px = qx
    py = qy
  }
}

///|
#export_name("bDisc")
pub fn b_disc(
  cx : Double,
  cy : Double,
  rx : Double,
  ry : Double,
  rot : Double,
  seg : Int,
  r : Double,
  g : Double,
  bl : Double,
  a : Double,
) -> Unit {
  disc(cx, cy, rx, ry, rot, seg, r, g, bl, a)
}

// 半圆盘（π 扇）：圆润端帽专用——整圆盘与线段带重叠会使端头发深；
// 半圆盘恰好补在线段带之外的延长区，零重叠、alpha 均匀

///|
fn half_disc(
  cx : Double,
  cy : Double,
  r : Double,
  phi : Double,
  seg : Int,
  cr : Double,
  cg : Double,
  cb : Double,
  a : Double,
) -> Unit {
  if r <= 0.0 || a <= 0.0 {
    return
  }
  if bs.count + seg * 3 > capacity {
    return
  }
  let mut px = 0.0
  let mut py = 0.0
  for i in 0..<(seg + 1) {
    let th = phi - @math.PI / 2.0 + @math.PI * i.to_double() / seg.to_double()
    let qx = cx + r * @math.cos(th)
    let qy = cy + r * @math.sin(th)
    if i > 0 {
      push(cx, cy, cr, cg, cb, a)
      push(px, py, cr, cg, cb, a)
      push(qx, qy, cr, cg, cb, a)
    }
    px = qx
    py = qy
  }
}

///|
fn stroke(
  x0 : Double,
  y0 : Double,
  x1 : Double,
  y1 : Double,
  w : Double,
  r : Double,
  g : Double,
  bl : Double,
  a : Double,
  round : Bool,
) -> Unit {
  let dx = x1 - x0
  let dy = y1 - y0
  let len = (dx * dx + dy * dy).sqrt()
  if len < 1.0e-8 {
    return
  }
  // 圆头 = 四边形带 + 两端朝外半圆盘（6 + 2×18 顶点，互不重叠）
  if bs.count + (if round { 42 } else { 6 }) > capacity {
    return
  }
  let hw = w / 2.0 / len
  let nx = -dy * hw
  let ny = dx * hw
  push(x0 + nx, y0 + ny, r, g, bl, a)
  push(x1 + nx, y1 + ny, r, g, bl, a)
  push(x0 - nx, y0 - ny, r, g, bl, a)
  push(x1 + nx, y1 + ny, r, g, bl, a)
  push(x1 - nx, y1 - ny, r, g, bl, a)
  push(x0 - nx, y0 - ny, r, g, bl, a)
  if round {
    let phi = @math.atan2(dy, dx)
    half_disc(x1, y1, w / 2.0, phi, 6, r, g, bl, a)
    half_disc(x0, y0, w / 2.0, phi + @math.PI, 6, r, g, bl, a)
  }
}

///|
#export_name("bStroke")
pub fn b_stroke(
  x0 : Double,
  y0 : Double,
  x1 : Double,
  y1 : Double,
  w : Double,
  r : Double,
  g : Double,
  bl : Double,
  a : Double,
  round : Bool,
) -> Unit {
  stroke(x0, y0, x1, y1, w, r, g, bl, a, round)
}

// pts/fade 由宿主写入 pts_buf/fade_buf 后调用；n 为 float 个数（点数 × 2）

///|
fn miter(
  n : Int,
  w : Double,
  r : Double,
  g : Double,
  bl : Double,
  base_a : Double,
  fade : Bool,
) -> Unit {
  if n < 4 {
    return
  }
  if bs.count + 3 * n > capacity {
    return
  }
  let hw = w / 2.0
  let limit = miter_limit.to_double() * hw
  let mut sx = 0.0
  let mut sy = 0.0
  let mut mx = 0.0
  let mut my = 0.0
  let mut pnx = 0.0
  let mut pny = 0.0
  let mut ready = false
  let mut i = 0
  while i + 3 < n {
    let ax = pts_buf[i].to_double()
    let ay = pts_buf[i + 1].to_double()
    let bx = pts_buf[i + 2].to_double()
    let by = pts_buf[i + 3].to_double()
    let dx = bx - ax
    let dy = by - ay
    let len = (dx * dx + dy * dy).sqrt()
    if len >= 1.0e-8 {
      let nx = -dy / len
      let ny = dx / len
      if !ready {
        sx = ax
        sy = ay
        mx = nx * hw
        my = ny * hw
        pnx = nx
        pny = ny
        ready = true
      } else {
        let mut tx = pnx + nx
        let mut ty = pny + ny
        let mut fl = (tx * tx + ty * ty).sqrt()
        if fl < 1.0e-6 {
          tx = nx
          ty = ny
          fl = 1.0
        } else {
          tx = tx / fl
          ty = ty / fl
          fl = hw / (pnx * tx + pny * ty)
          if fl > limit {
            fl = limit
          }
        }
        let ex = tx * fl
        let ey = ty * fl
        let a0 : Double = if fade {
          fade_buf[i / 2 - 1].to_double()
        } else {
          base_a
        }
        let a1 : Double = if fade {
          fade_buf[i / 2].to_double()
        } else {
          base_a
        }
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
    }
    i = i + 2
  }
  if ready {
    let bx = pts_buf[n - 2].to_double()
    let by = pts_buf[n - 1].to_double()
    let ex = pnx * hw
    let ey = pny * hw
    let a0 : Double = if fade {
      fade_buf[(n - 4) / 2].to_double()
    } else {
      base_a
    }
    let a1 : Double = if fade {
      fade_buf[(n - 2) / 2].to_double()
    } else {
      base_a
    }
    push(sx + mx, sy + my, r, g, bl, a0)
    push(bx + ex, by + ey, r, g, bl, a1)
    push(sx - mx, sy - my, r, g, bl, a0)
    push(bx + ex, by + ey, r, g, bl, a1)
    push(bx - ex, by - ey, r, g, bl, a1)
    push(sx - mx, sy - my, r, g, bl, a0)
  }
}

///|
#export_name("bPolylineFade")
pub fn b_polyline_fade(
  n : Int,
  w : Double,
  r : Double,
  g : Double,
  bl : Double,
) -> Unit {
  miter(n, w, r, g, bl, 0.0, true)
}

// 地形固体填充（marching squares）：宿主每关上传格心 SDF 场，每帧对可视格做等值线切割——
// 轮廓 = 格内线性插值的 d=0 线，矢量级锐利；颜色按入地深度指数渐近。越界格索引钳至边缘列 = 地形自然延展；
// 鞍点（对角双固体）以格心均值消歧

///|
fn tg_push(
  x : Double,
  y : Double,
  r : Double,
  g : Double,
  bl : Double,
  a : Double,
) -> Unit {
  let o = bs.tg_count * vertex_stride
  tg_data[o] = Float::from_double(x)
  tg_data[o + 1] = Float::from_double(y)
  tg_data[o + 2] = Float::from_double(r)
  tg_data[o + 3] = Float::from_double(g)
  tg_data[o + 4] = Float::from_double(bl)
  tg_data[o + 5] = Float::from_double(a)
  bs.tg_count = bs.tg_count + 1
}

///|
fn push_tg(x : Double, y : Double, d : Double) -> Unit {
  let depth : Double = if d < 0.0 { -d } else { 0.0 }
  let k = 1.0 - @math.exp(-depth / bs.tg_len)
  tg_push(
    x,
    y,
    bs.tg_sr + (bs.tg_dr - bs.tg_sr) * k,
    bs.tg_sg + (bs.tg_dg - bs.tg_sg) * k,
    bs.tg_sb + (bs.tg_db - bs.tg_sb) * k,
    1.0,
  )
}

///|
#export_name("bTerrainFieldBuf")
pub fn b_terrain_field_buf() -> Int {
  addr_of_f32(tg_field)
}

///|
#export_name("bTerrainFieldCap")
pub fn b_terrain_field_cap() -> Int {
  tg_cap
}

///|
#export_name("bTerrainField")
pub fn b_terrain_field(
  nx : Int,
  ny : Int,
  x0 : Double,
  y0 : Double,
  cell : Double,
  sr : Double,
  sg : Double,
  sb : Double,
  dr : Double,
  dg : Double,
  db : Double,
  depth_len : Double,
) -> Int {
  if nx < 2 || ny < 2 || nx * ny > tg_cap || depth_len <= 0.0 {
    return 1
  }
  bs.tg_nx = nx
  bs.tg_ny = ny
  bs.tg_x0 = x0
  bs.tg_y0 = y0
  bs.tg_cell = cell
  bs.tg_sr = sr
  bs.tg_sg = sg
  bs.tg_sb = sb
  bs.tg_dr = dr
  bs.tg_dg = dg
  bs.tg_db = db
  bs.tg_len = depth_len
  0
}

///|
#export_name("bTerrainDraw")
pub fn b_terrain_draw(i0 : Int, j0 : Int, i1 : Int, j1 : Int) -> Int {
  if bs.tg_nx < 2 || bs.tg_ny < 2 {
    return 0
  }
  if i1 <= i0 || j1 <= j0 {
    return 0
  }
  bs.tg_count = 0
  let mx = bs.tg_nx - 1
  let my = bs.tg_ny - 1
  let tg_nx = bs.tg_nx
  let tg_cell = bs.tg_cell
  let tg_x0 = bs.tg_x0
  let tg_y0 = bs.tg_y0
  for j in j0..<j1 {
    let mut bj = j
    if bj < 0 {
      bj = 0
    } else if bj > my {
      bj = my
    }
    let mut bj1 = j + 1
    if bj1 < 0 {
      bj1 = 0
    } else if bj1 > my {
      bj1 = my
    }
    let y0 = tg_y0 + j.to_double() * tg_cell
    let y1 = y0 + tg_cell
    for i in i0..<i1 {
      // 逐格预算（每格至多 12 顶点）：容量临界时优雅截断，而非整批丢弃导致地形闪烁/消失
      if bs.tg_count + 12 > tg_out_cap {
        return bs.tg_count
      }
      let mut ai = i
      if ai < 0 {
        ai = 0
      } else if ai > mx {
        ai = mx
      }
      let mut ai1 = i + 1
      if ai1 < 0 {
        ai1 = 0
      } else if ai1 > mx {
        ai1 = mx
      }
      let d00 = tg_field[bj * tg_nx + ai].to_double()
      let d10 = tg_field[bj * tg_nx + ai1].to_double()
      let d11 = tg_field[bj1 * tg_nx + ai1].to_double()
      let d01 = tg_field[bj1 * tg_nx + ai].to_double()
      let s00 = d00 <= 0.0
      let s10 = d10 <= 0.0
      let s11 = d11 <= 0.0
      let s01 = d01 <= 0.0
      let n = (if s00 { 1 } else { 0 }) +
        (if s10 { 1 } else { 0 }) +
        (if s11 { 1 } else { 0 }) +
        (if s01 { 1 } else { 0 })
      if n == 0 {
        continue
      }
      let x0 = tg_x0 + i.to_double() * tg_cell
      let x1 = x0 + tg_cell
      if n == 4 {
        push_tg(x0, y0, d00)
        push_tg(x1, y0, d10)
        push_tg(x0, y1, d01)
        push_tg(x1, y0, d10)
        push_tg(x1, y1, d11)
        push_tg(x0, y1, d01)
        continue
      }
      // 鞍点且格心为空气：两块固体互不相连，拆成两个独立三角形（行走法会错误连通）
      if n == 2 && s00 == s11 && d00 + d10 + d01 + d11 > 0.0 {
        let top_x = x0 + tg_cell * (d00 / (d00 - d10))
        let right_y = y0 + tg_cell * (d10 / (d10 - d11))
        let bot_x = x1 - tg_cell * (d11 / (d11 - d01))
        let left_y = y1 - tg_cell * (d01 / (d01 - d00))
        if s00 {
          push_tg(x0, y0, d00)
          push_tg(top_x, y0, 0.0)
          push_tg(x0, left_y, 0.0)
          push_tg(x1, y1, d11)
          push_tg(x1, right_y, 0.0)
          push_tg(bot_x, y1, 0.0)
        } else {
          push_tg(x1, y0, d10)
          push_tg(top_x, y0, 0.0)
          push_tg(x1, right_y, 0.0)
          push_tg(x0, y1, d01)
          push_tg(x0, left_y, 0.0)
          push_tg(bot_x, y1, 0.0)
        }
        continue
      }
      // 常规：绕格行走（TL→TR→BR→BL）收集固体角与交点成凸多边形，扇形化
      tg_cx[0] = x0
      tg_cy[0] = y0
      tg_cd[0] = d00
      tg_cs[0] = if s00 { b'\x01' } else { b'\x00' }
      tg_cx[1] = x1
      tg_cy[1] = y0
      tg_cd[1] = d10
      tg_cs[1] = if s10 { b'\x01' } else { b'\x00' }
      tg_cx[2] = x1
      tg_cy[2] = y1
      tg_cd[2] = d11
      tg_cs[2] = if s11 { b'\x01' } else { b'\x00' }
      tg_cx[3] = x0
      tg_cy[3] = y1
      tg_cd[3] = d01
      tg_cs[3] = if s01 { b'\x01' } else { b'\x00' }
      let mut m = 0
      for k in 0..<4 {
        let k2 = (k + 1) & 3
        if tg_cs[k] != b'\x00' {
          poly_x[m] = tg_cx[k]
          poly_y[m] = tg_cy[k]
          poly_d[m] = tg_cd[k]
          m = m + 1
        }
        if tg_cs[k] != tg_cs[k2] {
          let da = tg_cd[k]
          let tt = da / (da - tg_cd[k2])
          poly_x[m] = tg_cx[k] + (tg_cx[k2] - tg_cx[k]) * tt
          poly_y[m] = tg_cy[k] + (tg_cy[k2] - tg_cy[k]) * tt
          poly_d[m] = 0.0
          m = m + 1
        }
      }
      let mut k = 1
      while k + 1 < m {
        push_tg(poly_x[0], poly_y[0], poly_d[0])
        push_tg(poly_x[k], poly_y[k], poly_d[k])
        push_tg(poly_x[k + 1], poly_y[k + 1], poly_d[k + 1])
        k = k + 1
      }
    }
  }
  bs.tg_count
}

///|
#export_name("bTerrainData")
pub fn b_terrain_data() -> Int {
  addr_of_f32(tg_data)
}

///|
#export_name("bTerrainCap")
pub fn b_terrain_cap() -> Int {
  tg_out_cap
}

// 示踪粒子批量：宿主把可见粒子写入 tracer_buf（定长记录），单调用完成全部拖尾 tessellate + 头部圆盘，
// 替代逐粒子 polylineFade + disc（每帧约 800 次跨界 → 1 次）

///|
#export_name("bTracers")
pub fn b_tracers(count : Int, w : Double, head_r : Double) -> Unit {
  let lim = if count < tracer_cap { count } else { tracer_cap }
  for i in 0..<lim {
    let off = i * tracer_stride
    let r = tracer_buf[off].to_double()
    let g = tracer_buf[off + 1].to_double()
    let bl = tracer_buf[off + 2].to_double()
    let np = tracer_buf[off + 3].to_double().to_int()
    let head_a = tracer_buf[off + 4].to_double()
    if np <= 0 {
      continue
    }
    if np >= 2 {
      for k in 0..<np {
        pts_buf[k * 2] = tracer_buf[off + 5 + k * 3]
        pts_buf[k * 2 + 1] = tracer_buf[off + 6 + k * 3]
        fade_buf[k] = tracer_buf[off + 7 + k * 3]
      }
      miter(np * 2, w, r, g, bl, 0.0, true)
    }
    let hx = tracer_buf[off + 5 + (np - 1) * 3].to_double()
    let hy = tracer_buf[off + 6 + (np - 1) * 3].to_double()
    disc(hx, hy, head_r, head_r, 0.0, 10, r, g, bl, head_a)
  }
}

///|
#export_name("bDiscGrad")
pub fn b_disc_grad(
  cx : Double,
  cy : Double,
  radius : Double,
  seg : Int,
  cr : Double,
  cg : Double,
  cb : Double,
  ca : Double,
  er : Double,
  eg : Double,
  eb : Double,
  ea : Double,
) -> Unit {
  if radius <= 0.0 {
    return
  }
  if bs.count + seg * 3 > capacity {
    return
  }
  let mut px = 0.0
  let mut py = 0.0
  for i in 0..<(seg + 1) {
    let th = i.to_double() / seg.to_double() * @math.PI * 2.0
    let qx = cx + radius * @math.cos(th)
    let qy = cy + radius * @math.sin(th)
    if i > 0 {
      push(cx, cy, cr, cg, cb, ca)
      push(px, py, er, eg, eb, ea)
      push(qx, qy, er, eg, eb, ea)
    }
    px = qx
    py = qy
  }
}

///|
#export_name("bRing")
pub fn b_ring(
  cx : Double,
  cy : Double,
  rx : Double,
  ry : Double,
  rot : Double,
  seg : Int,
  w : Double,
  r : Double,
  g : Double,
  bl : Double,
  a : Double,
) -> Unit {
  if rx <= 0.0 || ry <= 0.0 || a <= 0.0 {
    return
  }
  let n = seg + 1
  if n * 2 > pts_cap {
    return
  }
  let cos = @math.cos(rot)
  let sin = @math.sin(rot)
  for i in 0..<(seg + 1) {
    let th = i.to_double() / seg.to_double() * @math.PI * 2.0
    let ex = rx * @math.cos(th)
    let ey = ry * @math.sin(th)
    pts_buf[i * 2] = Float::from_double(cx + ex * cos - ey * sin)
    pts_buf[i * 2 + 1] = Float::from_double(cy + ex * sin + ey * cos)
  }
  // 闭环折线（末点回首点）miter 接头：旧逐段 stroke 在接头处双重混合发深且有角度缺口
  miter(n * 2, w, r, g, bl, a, false)
}

// 与 polyline 复用 pts_buf：调用方不得在 arc 期间改写入参缓冲（单线程天然成立）

///|
fn arc(
  cx : Double,
  cy : Double,
  radius : Double,
  a0 : Double,
  a1 : Double,
  seg : Int,
  w : Double,
  r : Double,
  g : Double,
  bl : Double,
  a : Double,
) -> Unit {
  if radius <= 0.0 || a <= 0.0 || a1 == a0 {
    return
  }
  let n = seg + 1
  if n * 2 > pts_cap {
    return
  }
  for i in 0..<(seg + 1) {
    let th = a0 + (a1 - a0) * i.to_double() / seg.to_double()
    pts_buf[i * 2] = Float::from_double(cx + radius * @math.cos(th))
    pts_buf[i * 2 + 1] = Float::from_double(cy + radius * @math.sin(th))
  }
  miter(n * 2, w, r, g, bl, a, false)
  let hw = w / 2.0
  // 端帽 = 沿切线朝外的半圆盘（与折线带零重叠）：旧整圆盘与末段双混使虚线每节两端发深
  let i1 = seg * 2
  let phi0 = @math.atan2(
    pts_buf[1].to_double() - pts_buf[3].to_double(),
    pts_buf[0].to_double() - pts_buf[2].to_double(),
  )
  let phi1 = @math.atan2(
    pts_buf[i1 + 1].to_double() - pts_buf[i1 - 1].to_double(),
    pts_buf[i1].to_double() - pts_buf[i1 - 2].to_double(),
  )
  half_disc(
    pts_buf[0].to_double(),
    pts_buf[1].to_double(),
    hw,
    phi0,
    6,
    r,
    g,
    bl,
    a,
  )
  half_disc(
    pts_buf[i1].to_double(),
    pts_buf[i1 + 1].to_double(),
    hw,
    phi1,
    6,
    r,
    g,
    bl,
    a,
  )
}

///|
#export_name("bArc")
pub fn b_arc(
  cx : Double,
  cy : Double,
  radius : Double,
  a0 : Double,
  a1 : Double,
  seg : Int,
  w : Double,
  r : Double,
  g : Double,
  bl : Double,
  a : Double,
) -> Unit {
  arc(cx, cy, radius, a0, a1, seg, w, r, g, bl, a)
}

///|
#export_name("bDashRing")
pub fn b_dash_ring(
  cx : Double,
  cy : Double,
  radius : Double,
  on : Double,
  off : Double,
  w : Double,
  r : Double,
  g : Double,
  bl : Double,
  a : Double,
) -> Unit {
  let circ = @math.PI * 2.0 * radius
  let mut on_len = on
  let mut off_len = off
  let mut period = on_len + off_len
  if circ <= 0.0 || period <= 0.0 {
    return
  }
  if circ < 6.0 * period {
    let k = circ / (6.0 * period)
    on_len = on_len * k
    off_len = off_len * k
    period = on_len + off_len
  }
  let mut s = 0.0
  while s < circ {
    let seg_len = @cmp.minimum(on_len, circ - s)
    let ang0 = s / radius
    let ang1 = (s + seg_len) / radius
    let mut segs = (seg_len / 0.5).ceil().to_int()
    if segs < 2 {
      segs = 2
    }
    arc(cx, cy, radius, ang0, ang1, segs, w, r, g, bl, a)
    s = s + period
  }
}
