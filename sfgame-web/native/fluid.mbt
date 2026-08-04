// 造风 · 流体求解器（MoonBit → WebAssembly）
//
// 与 src/sim/fluid.ts 的 JS 求解器逐位一致：f32 存储（FixedArray[Float]）、
// f64 中间量（Double）、相同运算次序——两套引擎物理逐帧相同，可无感切换。
//
// 内存协议（JS 以 TypedArray 视图读写线性内存低地址段，须低于
// heap-start-address=131072，避开 MoonBit 堆）：
//   偏移 0      : u（n 个 f32，fluid_sync_out 后为新值）
//   偏移 n*4    : v
//   偏移 2*n*4  : t
//   偏移 3*n*4  : solid（n 个 u8 掩码，JS 写入后调 fluid_set_solid）
// n = nx * ny

extern "wasm" fn load_f32(addr: Int) -> Double =
  #|(func (param i32) (result f64)
  #|  local.get 0
  #|  f32.load
  #|  f64.promote_f32
  #|)

extern "wasm" fn store_f32(addr: Int, v: Double) -> Unit =
  #|(func (param i32 f64)
  #|  local.get 0
  #|  local.get 1
  #|  f32.demote_f64
  #|  f32.store
  #|)

extern "wasm" fn load_u8(addr: Int) -> Int =
  #|(func (param i32) (result i32)
  #|  local.get 0
  #|  i32.load8_u
  #|)

extern "wasm" fn store_u8(addr: Int, v: Int) -> Unit =
  #|(func (param i32 i32)
  #|  local.get 0
  #|  local.get 1
  #|  i32.store8
  #|)

struct FluidState {
  nx: Int
  ny: Int
  cell: Double
  buoyancy: Double
  t_max: Double
  heat_rate: Double
  source_radius: Double
  vel_damping: Double
  t_damping: Double
  iterations: Int
  vorticity: Double
  u: FixedArray[Float]
  v: FixedArray[Float]
  t: FixedArray[Float]
  solid: FixedArray[Byte]
  u0: FixedArray[Float]
  v0: FixedArray[Float]
  t0: FixedArray[Float]
  q1: FixedArray[Float]
  q2: FixedArray[Float]
  p: FixedArray[Float]
  div: FixedArray[Float]
  div_h2: FixedArray[Double]
  curl: FixedArray[Float]
  solid_idx: FixedArray[Int]
  solid_count: Int
}

let fluid: Ref[FluidState?] = Ref::Ref(None)

fn dabs(d: Double) -> Double {
  if d < 0.0 { -d } else { d }
}

#export_name("fluid_new")
pub fn fluid_new(
  nx: Int,
  ny: Int,
  cell: Double,
  buoyancy: Double,
  t_max: Double,
  heat_rate: Double,
  source_radius: Double,
  vel_damping: Double,
  t_damping: Double,
  iterations: Int,
  vorticity: Double,
) -> Unit {
  let n = nx * ny
  let zero: Float = 0.0
  let byte0: Byte = 0
  fluid.val = Some({
    nx: nx,
    ny: ny,
    cell: cell,
    buoyancy: buoyancy,
    t_max: t_max,
    heat_rate: heat_rate,
    source_radius: source_radius,
    vel_damping: vel_damping,
    t_damping: t_damping,
    iterations: iterations,
    vorticity: vorticity,
    u: FixedArray::make(n, zero),
    v: FixedArray::make(n, zero),
    t: FixedArray::make(n, zero),
    solid: FixedArray::make(n, byte0),
    u0: FixedArray::make(n, zero),
    v0: FixedArray::make(n, zero),
    t0: FixedArray::make(n, zero),
    q1: FixedArray::make(n, zero),
    q2: FixedArray::make(n, zero),
    p: FixedArray::make(n, zero),
    div: FixedArray::make(n, zero),
    div_h2: FixedArray::make(n, 0.0),
    curl: FixedArray::make(n, zero),
    solid_idx: FixedArray::make(n, 0),
    solid_count: 0,
  })
}

#export_name("fluid_clear")
pub fn fluid_clear() -> Unit {
  match fluid.val {
    None => ()
    Some(s) => {
      for i = 0; i < s.u.length(); i = i + 1 {
        s.u[i] = 0.0
        s.v[i] = 0.0
        s.t[i] = 0.0
        s.p[i] = 0.0
      }
    }
  }
}

/// 把 JS 已写入暂存区的 solid 掩码拷入内部（一次性），并构建固体索引表。
#export_name("fluid_set_solid")
pub fn fluid_set_solid(src: Int) -> Unit {
  match fluid.val {
    None => ()
    Some(s) => {
      for i = 0; i < s.solid.length(); i = i + 1 {
        s.solid[i] = (load_u8(src + i)).to_byte()
      }
      let mut n = 0
      for i = 0; i < s.solid.length(); i = i + 1 {
        if s.solid[i] != (0 : Byte) {
          s.solid_idx[n] = i
          n = n + 1
        }
      }
      s.solid_count = n
    }
  }
}

fn apply_buoyancy(s: FluidState, dt: Double) -> Unit {
  let k = s.buoyancy * dt
  // 固体格 t=0 不变量 → v -= k*0 恒为无操作，分支可去（逐位不变）
  for j = 1; j < s.ny - 1; j = j + 1 {
    let row = j * s.nx
    for i = 1; i < s.nx - 1; i = i + 1 {
      let idx = i + row
      s.v[idx] = (s.v[idx].to_double() - k * s.t[idx].to_double()).to_float()
    }
  }
}

fn apply_vorticity(s: FluidState, dt: Double) -> Unit {
  let h2 = 2.0 * s.cell
  let nx = s.nx
  for j = 1; j < s.ny - 1; j = j + 1 {
    let row = j * nx
    for i = 1; i < nx - 1; i = i + 1 {
      let idx = i + row
      if s.solid[idx] != (0 : Byte) {
        s.curl[idx] = 0.0
        continue
      }
      let v1 = (s.v[idx + 1].to_double() - s.v[idx - 1].to_double()) / h2
      let v2 = (s.u[idx + nx].to_double() - s.u[idx - nx].to_double()) / h2
      s.curl[idx] = (v1 - v2).to_float()
    }
  }
  let f = s.vorticity * s.cell * dt
  for j = 2; j < s.ny - 2; j = j + 1 {
    let row = j * nx
    for i = 2; i < nx - 2; i = i + 1 {
      let idx = i + row
      if s.solid[idx] != (0 : Byte) { continue }
      let dwdx = (dabs(s.curl[idx + 1].to_double()) - dabs(s.curl[idx - 1].to_double())) / h2
      let dwdy = (dabs(s.curl[idx + nx].to_double()) - dabs(s.curl[idx - nx].to_double())) / h2
      let len = (dwdx * dwdx + dwdy * dwdy).sqrt() + 0.00001
      let nx_n = dwdx / len
      let ny_n = dwdy / len
      let w = s.curl[idx].to_double()
      s.u[idx] = (s.u[idx].to_double() + f * ny_n * w).to_float()
      s.v[idx] = (s.v[idx].to_double() - f * nx_n * w).to_float()
    }
  }
}

/// 单趟半拉格朗日平流（与 JS advectPass 同构）。
fn advect_pass(s: FluidState, dst: FixedArray[Float], src: FixedArray[Float], dt: Double, sign: Double) -> Unit {
  let nx = s.nx
  let dt0 = (dt / s.cell) * sign
  for j = 1; j < s.ny - 1; j = j + 1 {
    let row = j * nx
    for i = 1; i < nx - 1; i = i + 1 {
      let idx = i + row
      if s.solid[idx] != (0 : Byte) {
        dst[idx] = 0.0
        continue
      }
      let mut x = i.to_double() - dt0 * s.u0[idx].to_double()
      let mut y = j.to_double() - dt0 * s.v0[idx].to_double()
      if x < 0.5 {
        x = 0.5
      } else if x > nx.to_double() - 1.5 {
        x = nx.to_double() - 1.5
      }
      if y < 0.5 {
        y = 0.5
      } else if y > s.ny.to_double() - 1.5 {
        y = s.ny.to_double() - 1.5
      }
      // 钳制后 x/y 恒为正：to_int（向零截断）与 JS |0 逐位等价
      let i0 = x.to_int()
      let j0 = y.to_int()
      let fx = x - i0.to_double()
      let fy = y - j0.to_double()
      let a = i0 + j0 * nx
      let b = a + 1
      let c = a + nx
      let d = c + 1
      let w0 = (1.0 - fx) * (1.0 - fy)
      let w1 = fx * (1.0 - fy)
      let w2 = (1.0 - fx) * fy
      let w3 = fx * fy
      let v = src[a].to_double() * w0 + src[b].to_double() * w1 + src[c].to_double() * w2 + src[d].to_double() * w3
      dst[idx] = v.to_float()
    }
  }
}

/// MacCormack 二阶平流（与 JS advectMacCormack 同构）。
fn advect_mac_cormack(s: FluidState, dst: FixedArray[Float], src: FixedArray[Float], dt: Double, damping: Double) -> Unit {
  let nx = s.nx
  advect_pass(s, s.q1, src, dt, 1.0)
  advect_pass(s, s.q2, s.q1, dt, -1.0)
  for j = 1; j < s.ny - 1; j = j + 1 {
    let row = j * nx
    for i = 1; i < nx - 1; i = i + 1 {
      let idx = i + row
      if s.solid[idx] != (0 : Byte) {
        dst[idx] = 0.0
        continue
      }
      // 3×3 邻域极值——展开保持原比较次序（含固体格，其值为 0）
      let mut lo = src[idx].to_double()
      let mut hi = lo
      let v1 = src[idx - nx - 1].to_double()
      if v1 < lo { lo = v1 } else if v1 > hi { hi = v1 }
      let v2 = src[idx - nx].to_double()
      if v2 < lo { lo = v2 } else if v2 > hi { hi = v2 }
      let v3 = src[idx - nx + 1].to_double()
      if v3 < lo { lo = v3 } else if v3 > hi { hi = v3 }
      let v4 = src[idx - 1].to_double()
      if v4 < lo { lo = v4 } else if v4 > hi { hi = v4 }
      let v5 = src[idx].to_double()
      if v5 < lo { lo = v5 } else if v5 > hi { hi = v5 }
      let v6 = src[idx + 1].to_double()
      if v6 < lo { lo = v6 } else if v6 > hi { hi = v6 }
      let v7 = src[idx + nx - 1].to_double()
      if v7 < lo { lo = v7 } else if v7 > hi { hi = v7 }
      let v8 = src[idx + nx].to_double()
      if v8 < lo { lo = v8 } else if v8 > hi { hi = v8 }
      let v9 = src[idx + nx + 1].to_double()
      if v9 < lo { lo = v9 } else if v9 > hi { hi = v9 }
      let mut val = s.q1[idx].to_double() + (src[idx].to_double() - s.q2[idx].to_double()) * 0.5
      if val < lo {
        val = lo
      } else if val > hi {
        val = hi
      }
      dst[idx] = (val * damping).to_float()
    }
  }
}

fn project(s: FluidState) -> Unit {
  let nx = s.nx
  let h = s.cell
  let inv2h = 1.0 / (2.0 * h)
  let h2 = h * h
  for j = 1; j < s.ny - 1; j = j + 1 {
    let row = j * nx
    for i = 1; i < nx - 1; i = i + 1 {
      let idx = i + row
      if s.solid[idx] != (0 : Byte) {
        s.div[idx] = 0.0
        s.p[idx] = 0.0
        continue
      }
      let ur = if s.solid[idx + 1] != (0 : Byte) { 0.0 } else { s.u[idx + 1].to_double() }
      let ul = if s.solid[idx - 1] != (0 : Byte) { 0.0 } else { s.u[idx - 1].to_double() }
      let vd = if s.solid[idx + nx] != (0 : Byte) { 0.0 } else { s.v[idx + nx].to_double() }
      let vu = if s.solid[idx - nx] != (0 : Byte) { 0.0 } else { s.v[idx - nx].to_double() }
      s.div[idx] = ((ur - ul + vd - vu) * inv2h).to_float()
    }
  }
  // h²×div 预乘一次（f64 存储，与逐迭代 h2*div[idx] 逐位相同）
  for i = 0; i < s.div.length(); i = i + 1 {
    s.div_h2[i] = h2 * s.div[i].to_double()
  }
  let iterations = s.iterations
  for it = 0; it < iterations; it = it + 1 {
    for parity = 0; parity < 2; parity = parity + 1 {
      for j = 1; j < s.ny - 1; j = j + 1 {
        let i0 = if ((parity ^ (j & 1)) & 1) != 0 { 1 } else { 2 }
        let row = j * nx
        for i = i0; i < nx - 1; i = i + 2 {
          let idx = i + row
          if s.solid[idx] != (0 : Byte) { continue }
          let pl = if s.solid[idx - 1] != (0 : Byte) { s.p[idx].to_double() } else { s.p[idx - 1].to_double() }
          let pr = if s.solid[idx + 1] != (0 : Byte) { s.p[idx].to_double() } else { s.p[idx + 1].to_double() }
          let pu = if s.solid[idx - nx] != (0 : Byte) { s.p[idx].to_double() } else { s.p[idx - nx].to_double() }
          let pd = if s.solid[idx + nx] != (0 : Byte) { s.p[idx].to_double() } else { s.p[idx + nx].to_double() }
          let pn = (pl + pr + pu + pd - s.div_h2[idx]) * 0.25
          s.p[idx] = pn.to_float()
        }
      }
    }
  }
  for j = 1; j < s.ny - 1; j = j + 1 {
    let row = j * nx
    for i = 1; i < nx - 1; i = i + 1 {
      let idx = i + row
      if s.solid[idx] != (0 : Byte) { continue }
      let pl = if s.solid[idx - 1] != (0 : Byte) { s.p[idx].to_double() } else { s.p[idx - 1].to_double() }
      let pr = if s.solid[idx + 1] != (0 : Byte) { s.p[idx].to_double() } else { s.p[idx + 1].to_double() }
      let pu = if s.solid[idx - nx] != (0 : Byte) { s.p[idx].to_double() } else { s.p[idx - nx].to_double() }
      let pd = if s.solid[idx + nx] != (0 : Byte) { s.p[idx].to_double() } else { s.p[idx + nx].to_double() }
      s.u[idx] = (s.u[idx].to_double() - (pr - pl) * inv2h).to_float()
      s.v[idx] = (s.v[idx].to_double() - (pd - pu) * inv2h).to_float()
    }
  }
}

fn enforce_boundary(s: FluidState) -> Unit {
  for k = 0; k < s.solid_count; k = k + 1 {
    let idx = s.solid_idx[k]
    s.u[idx] = 0.0
    s.v[idx] = 0.0
    s.t[idx] = 0.0
  }
}

#export_name("fluid_add_heat")
pub fn fluid_add_heat(wx: Double, wy: Double, amount: Double) -> Unit {
  match fluid.val {
    None => ()
    Some(s) => {
      let gr = s.source_radius / s.cell
      let gx = wx / s.cell - 0.5
      let gy = wy / s.cell - 0.5
      let x0_raw = (gx - gr).floor().to_int()
      let x0 = if x0_raw < 1 { 1 } else { x0_raw }
      let x1_raw = (gx + gr).ceil().to_int()
      let x1 = if x1_raw > s.nx - 2 { s.nx - 2 } else { x1_raw }
      let y0_raw = (gy - gr).floor().to_int()
      let y0 = if y0_raw < 1 { 1 } else { y0_raw }
      let y1_raw = (gy + gr).ceil().to_int()
      let y1 = if y1_raw > s.ny - 2 { s.ny - 2 } else { y1_raw }
      let t_max = s.t_max
      for j = y0; j <= y1; j = j + 1 {
        for i = x0; i <= x1; i = i + 1 {
          let idx = i + j * s.nx
          if s.solid[idx] != (0 : Byte) { continue }
          let dx = i.to_double() - gx
          let dy = j.to_double() - gy
          let d = (dx * dx + dy * dy).sqrt()
          if d >= gr { continue }
          let falloff = 1.0 - d / gr
          let mut val = s.t[idx].to_double() + amount * falloff
          if val > t_max {
            val = t_max
          } else if val < -t_max {
            val = -t_max
          }
          s.t[idx] = val.to_float()
        }
      }
    }
  }
}

#export_name("fluid_step")
pub fn fluid_step(dt: Double) -> Unit {
  match fluid.val {
    None => ()
    Some(s) => {
      apply_buoyancy(s, dt)
      if s.vorticity > 0.0 {
        apply_vorticity(s, dt)
      }
      for i = 0; i < s.u.length(); i = i + 1 {
        s.u0[i] = s.u[i]
        s.v0[i] = s.v[i]
        s.t0[i] = s.t[i]
      }
      advect_mac_cormack(s, s.u, s.u0, dt, s.vel_damping)
      advect_mac_cormack(s, s.v, s.v0, dt, s.vel_damping)
      advect_mac_cormack(s, s.t, s.t0, dt, s.t_damping)
      project(s)
      enforce_boundary(s)
    }
  }
}

/// 把 u/v/t 拷入线性内存暂存区（JS 采样读取）。
#export_name("fluid_sync_out")
pub fn fluid_sync_out() -> Unit {
  match fluid.val {
    None => ()
    Some(s) => {
      let n = s.u.length()
      let u_off = 0
      let v_off = n * 4
      let t_off = n * 8
      for i = 0; i < n; i = i + 1 {
        store_f32(u_off + i * 4, s.u[i].to_double())
        store_f32(v_off + i * 4, s.v[i].to_double())
        store_f32(t_off + i * 4, s.t[i].to_double())
      }
    }
  }
}
