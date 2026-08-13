// 流体内核（assembly/core.ts 的 Moonbit 同构移植）：f32 存储 / f64 中间量，
// 混沌流场（李雅普诺夫放大）下任何降 f32 都会指数放大差异，全链路严禁；
// 逐位一致由 tests/engine-golden.test.ts golden hash 钉死。红黑 GS 相位内单元格
// 独立（von Neumann 邻域全异奇偶）→ 空气索引表 + f64x2 SIMD 与标量逐位等价。

///|
let max_nx : Int = 160

///|
let max_ny : Int = 120

///|
let max_cells : Int = max_nx * max_ny

///|
let u : FixedArray[Float] = FixedArray::make(max_cells, 0.0)

///|
let v : FixedArray[Float] = FixedArray::make(max_cells, 0.0)

///|
let t : FixedArray[Float] = FixedArray::make(max_cells, 0.0)

///|
let solid : FixedArray[Byte] = FixedArray::make(max_cells, b'\x00')

///|
let u0 : FixedArray[Float] = FixedArray::make(max_cells, 0.0)

///|
let v0 : FixedArray[Float] = FixedArray::make(max_cells, 0.0)

///|
let t0 : FixedArray[Float] = FixedArray::make(max_cells, 0.0)

///|
let p : FixedArray[Float] = FixedArray::make(max_cells, 0.0)
// 散度 × h²（f64）：project_div 直接产出，GS 消费（不存 f32 中间量，少一趟扫描）

///|
let div_h2 : FixedArray[Double] = FixedArray::make(max_cells, 0.0)
// 环境风位流基场：远场单位水平风的贴地绕流（烘焙一次，采样按强度线性叠加）

///|
let fx_u : FixedArray[Float] = FixedArray::make(max_cells, 0.0)

///|
let fx_v : FixedArray[Float] = FixedArray::make(max_cells, 0.0)
// 空气索引表（rebuild_solid 按行主序重建，地形静态跨步复用）：扫描只迭代空气格免固体分支；
// bulk = 四邻全空气主体格走 GS 免检查快路径（红黑相位内遍历顺序无关，见文件头）

///|
let air_list : FixedArray[Int] = FixedArray::make(max_cells, 0)

///|
let air_i : FixedArray[Int] = FixedArray::make(max_cells, 0)

///|
let air_j : FixedArray[Int] = FixedArray::make(max_cells, 0)

///|
let air_even : FixedArray[Int] = FixedArray::make(max_cells, 0)

///|
let air_odd : FixedArray[Int] = FixedArray::make(max_cells, 0)

///|
let bulk : FixedArray[Byte] = FixedArray::make(max_cells, b'\x00')

///|
let solid_list : FixedArray[Int] = FixedArray::make(max_cells, 0)

///|
priv struct Params {
  mut nx : Int
  mut ny : Int
  mut cell : Double
  mut buoyancy : Double
  mut t_max : Double
  mut source_radius : Double
  mut vel_damping : Double
  mut t_damping : Double
  mut iterations : Int
  mut margin_cells : Int
  mut ox : Int
  mut oy : Int
  mut sponge_vel_in : Double
  mut sponge_vel_out : Double
  mut sponge_t_out : Double
  mut ambient_x : Double
  mut ambient_y : Double
  mut ambient_t : Double
  mut out_vx : Double
  mut out_vy : Double
  mut solid_count : Int
  mut air_count : Int
  mut air_even_count : Int
  mut air_odd_count : Int
}

///|
let pm : Params = Params::{
  nx: 0,
  ny: 0,
  cell: 0.0,
  buoyancy: 0.0,
  t_max: 0.0,
  source_radius: 0.0,
  vel_damping: 0.0,
  t_damping: 0.0,
  iterations: 0,
  margin_cells: 0,
  ox: 0,
  oy: 0,
  sponge_vel_in: 0.0,
  sponge_vel_out: 0.0,
  sponge_t_out: 0.0,
  ambient_x: 0.0,
  ambient_y: 0.0,
  ambient_t: 0.0,
  out_vx: 0.0,
  out_vy: 0.0,
  solid_count: 0,
  air_count: 0,
  air_even_count: 0,
  air_odd_count: 0,
}

// 导出名 init（对齐 assembly 契约）；Moonbit 保留无参 fn init 作包初始化，故本地名 fluid_init

///|
#export_name("init")
pub fn fluid_init(
  nx_ : Int,
  ny_ : Int,
  cell_ : Double,
  buoyancy_ : Double,
  t_max_ : Double,
  _heat_rate : Double,
  source_radius_ : Double,
  vel_damping_ : Double,
  t_damping_ : Double,
  iterations_ : Int,
  margin_cells_ : Int,
) -> Int {
  guard nx_ >= 3 && ny_ >= 3 && nx_ <= max_nx && ny_ <= max_ny else { 1 }
  pm.nx = nx_
  pm.ny = ny_
  pm.cell = cell_
  pm.buoyancy = buoyancy_
  pm.t_max = t_max_
  // _heat_rate 内核不消费（宿主按 dt 缩放后传入 addHeat），参数仅为对齐 assembly 接口
  pm.source_radius = source_radius_
  pm.vel_damping = vel_damping_
  pm.t_damping = t_damping_
  pm.iterations = iterations_
  pm.margin_cells = margin_cells_
  pm.ox = margin_cells_
  pm.oy = margin_cells_
  pm.sponge_vel_in = 0.999
  pm.sponge_vel_out = 0.97
  pm.sponge_t_out = 0.94
  pm.ambient_x = 0.0
  pm.ambient_y = 0.0
  pm.ambient_t = 0.0
  clear()
  // 全空气域基线表（solid 初始全 0）；真实地形经 rebuildSolid 重建
  build_air_lists()
  bake_ambient_basis()
  0
}

///|
#export_name("clear")
pub fn clear() -> Unit {
  let bytes = pm.nx * pm.ny * 4
  mem_fill(addr_of_f32(u), 0, bytes)
  mem_fill(addr_of_f32(v), 0, bytes)
  mem_fill(addr_of_f32(t), 0, bytes)
  mem_fill(addr_of_f32(p), 0, bytes)
}

///|
#export_name("setAmbient")
pub fn set_ambient(x : Double, y : Double, temp : Double) -> Unit {
  pm.ambient_x = x
  pm.ambient_y = y
  pm.ambient_t = temp
}

// 环境风 = 预烘焙位流基场 × 强度：远场单位水平风、地面/顶面不可穿透、左右开边界。
// φ 初值 = x 坡道；SOR 求解 Laplace（左右边列 Dirichlet 坡道，地面/顶面 Neumann 镜像），
// 速度 = ∇φ 中心差分，固体邻居代入有效值使界面法向分量为零。Scratch 复用 p，结束清零。

///|
fn bake_ambient_basis() -> Unit {
  let nx = pm.nx
  let ny = pm.ny
  for j in 0..<ny {
    let row = j * nx
    for i in 0..<nx {
      p[i + row] = Float::from_int(i)
    }
  }
  let omega = 1.85
  for _ in 0..<200 {
    for j in 1..<(ny - 1) {
      let row = j * nx
      for i in 1..<(nx - 1) {
        let idx = i + row
        if solid[idx] != b'\x00' {
          continue
        }
        let p_l : Double = if solid[idx - 1] != b'\x00' {
          if i - 1 == 0 {
            0.0
          } else {
            p[idx].to_double()
          }
        } else {
          p[idx - 1].to_double()
        }
        let p_r : Double = if solid[idx + 1] != b'\x00' {
          if i + 1 == nx - 1 {
            (nx - 1).to_double()
          } else {
            p[idx].to_double()
          }
        } else {
          p[idx + 1].to_double()
        }
        let p_u : Double = if solid[idx - nx] != b'\x00' {
          p[idx].to_double()
        } else {
          p[idx - nx].to_double()
        }
        let p_d : Double = if solid[idx + nx] != b'\x00' {
          p[idx].to_double()
        } else {
          p[idx + nx].to_double()
        }
        p[idx] = Float::from_double(
          p[idx].to_double() +
          omega * ((p_l + p_r + p_u + p_d) * 0.25 - p[idx].to_double()),
        )
      }
    }
  }
  let bytes = nx * ny * 4
  mem_fill(addr_of_f32(fx_u), 0, bytes)
  mem_fill(addr_of_f32(fx_v), 0, bytes)
  for j in 1..<(ny - 1) {
    let row = j * nx
    for i in 1..<(nx - 1) {
      let idx = i + row
      if solid[idx] != b'\x00' {
        continue
      }
      let p_l : Double = if solid[idx - 1] != b'\x00' {
        if i - 1 == 0 {
          0.0
        } else {
          p[idx].to_double()
        }
      } else {
        p[idx - 1].to_double()
      }
      let p_r : Double = if solid[idx + 1] != b'\x00' {
        if i + 1 == nx - 1 {
          (nx - 1).to_double()
        } else {
          p[idx].to_double()
        }
      } else {
        p[idx + 1].to_double()
      }
      let p_u : Double = if solid[idx - nx] != b'\x00' {
        p[idx].to_double()
      } else {
        p[idx - nx].to_double()
      }
      let p_d : Double = if solid[idx + nx] != b'\x00' {
        p[idx].to_double()
      } else {
        p[idx + nx].to_double()
      }
      fx_u[idx] = Float::from_double((p_r - p_l) * 0.5)
      fx_v[idx] = Float::from_double((p_d - p_u) * 0.5)
    }
  }
  mem_fill(addr_of_f32(p), 0, bytes)
}

///|
fn build_air_lists() -> Unit {
  let nx = pm.nx
  let ny = pm.ny
  mem_fill(addr_of_u8(bulk), 0, nx * ny)
  let mut c = 0
  let mut ce = 0
  let mut co = 0
  // 只收录内域格（1..nx-2 × 1..ny-2）：与旧循环边界一致，越界邻居恒不出现
  for j in 1..<(ny - 1) {
    let row = j * nx
    for i in 1..<(nx - 1) {
      let idx = i + row
      if solid[idx] != b'\x00' {
        continue
      }
      air_list[c] = idx
      air_i[c] = i
      air_j[c] = j
      c = c + 1
      if ((i + j) & 1) == 0 {
        air_even[ce] = idx
        ce = ce + 1
      } else {
        air_odd[co] = idx
        co = co + 1
      }
      if solid[idx - 1] == b'\x00' &&
        solid[idx + 1] == b'\x00' &&
        solid[idx - nx] == b'\x00' &&
        solid[idx + nx] == b'\x00' {
        bulk[idx] = b'\x01'
      }
    }
  }
  pm.air_count = c
  pm.air_even_count = ce
  pm.air_odd_count = co
}

///|
#export_name("rebuildSolid")
pub fn rebuild_solid() -> Unit {
  let nx = pm.nx
  let ny = pm.ny
  let mut c = 0
  for j in 0..<ny {
    let row = j * nx
    for i in 0..<nx {
      let idx = i + row
      if solid[idx] != b'\x00' {
        solid_list[c] = idx
        c = c + 1
      }
    }
  }
  pm.solid_count = c
  build_air_lists()
  bake_ambient_basis()
}

// 动量注入（风扇等）：以 (fx,fy) 方向为单位，在 radius 圆域内按 falloff 加量（宿主已含 dt 缩放）；
// 随后的平流/压强投影把注入量塑造成带卷吸的射流

///|
#export_name("addForce")
pub fn add_force(
  wx : Double,
  wy : Double,
  fx : Double,
  fy : Double,
  amount : Double,
  radius : Double,
) -> Unit {
  let len = (fx * fx + fy * fy).sqrt()
  if len < 1.0e-6 {
    return
  }
  let dxu = fx / len
  let dyv = fy / len
  let nx = pm.nx
  let ny = pm.ny
  let gr = radius / pm.cell
  let gx = wx / pm.cell - 0.5 + pm.ox.to_double()
  let gy = wy / pm.cell - 0.5 + pm.oy.to_double()
  let mut x0 = (gx - gr).floor().to_int()
  if x0 < 1 {
    x0 = 1
  }
  let mut x1 = (gx + gr).ceil().to_int()
  if x1 > nx - 2 {
    x1 = nx - 2
  }
  let mut y0 = (gy - gr).floor().to_int()
  if y0 < 1 {
    y0 = 1
  }
  let mut y1 = (gy + gr).ceil().to_int()
  if y1 > ny - 2 {
    y1 = ny - 2
  }
  for j in y0..<(y1 + 1) {
    let row = j * nx
    for i in x0..<(x1 + 1) {
      let idx = i + row
      if solid[idx] != b'\x00' {
        continue
      }
      let dx = i.to_double() - gx
      let dy = j.to_double() - gy
      let d = (dx * dx + dy * dy).sqrt()
      if d >= gr {
        continue
      }
      let falloff = 1.0 - d / gr
      u[idx] = Float::from_double(u[idx].to_double() + amount * dxu * falloff)
      v[idx] = Float::from_double(v[idx].to_double() + amount * dyv * falloff)
    }
  }
}

///|
#export_name("addHeat")
pub fn add_heat(wx : Double, wy : Double, amount : Double) -> Unit {
  let nx = pm.nx
  let ny = pm.ny
  let gr = pm.source_radius / pm.cell
  let gx = wx / pm.cell - 0.5 + pm.ox.to_double()
  let gy = wy / pm.cell - 0.5 + pm.oy.to_double()
  let mut x0 = (gx - gr).floor().to_int()
  if x0 < 1 {
    x0 = 1
  }
  let mut x1 = (gx + gr).ceil().to_int()
  if x1 > nx - 2 {
    x1 = nx - 2
  }
  let mut y0 = (gy - gr).floor().to_int()
  if y0 < 1 {
    y0 = 1
  }
  let mut y1 = (gy + gr).ceil().to_int()
  if y1 > ny - 2 {
    y1 = ny - 2
  }
  for j in y0..<(y1 + 1) {
    let row = j * nx
    for i in x0..<(x1 + 1) {
      let idx = i + row
      if solid[idx] != b'\x00' {
        continue
      }
      let dx = i.to_double() - gx
      let dy = j.to_double() - gy
      let d = (dx * dx + dy * dy).sqrt()
      if d >= gr {
        continue
      }
      let falloff = 1.0 - d / gr
      let mut val = t[idx].to_double() + amount * falloff
      if val > pm.t_max {
        val = pm.t_max
      } else if val < -pm.t_max {
        val = -pm.t_max
      }
      t[idx] = Float::from_double(val)
    }
  }
}

///|
#export_name("sampleVelocity")
pub fn sample_velocity(wx : Double, wy : Double) -> Unit {
  let nx = pm.nx
  let ny = pm.ny
  let mut gx = wx / pm.cell - 0.5 + pm.ox.to_double()
  let mut gy = wy / pm.cell - 0.5 + pm.oy.to_double()
  if gx < 0.0 {
    gx = 0.0
  } else if gx > nx.to_double() - 1.001 {
    gx = nx.to_double() - 1.001
  }
  if gy < 0.0 {
    gy = 0.0
  } else if gy > ny.to_double() - 1.001 {
    gy = ny.to_double() - 1.001
  }
  let i0 = gx.floor().to_int()
  let j0 = gy.floor().to_int()
  let fx = gx - i0.to_double()
  let fy = gy - j0.to_double()
  let a = i0 + j0 * nx
  let b = a + 1
  let c = a + nx
  let d = c + 1
  let w00 = (1.0 - fx) * (1.0 - fy)
  let w10 = fx * (1.0 - fy)
  let w01 = (1.0 - fx) * fy
  let w11 = fx * fy
  // 环境风 = 位流基场 × 强度；ambient_y 为裸叠加（关卡均未用非零垂直风，未烘焙垂直基）
  pm.out_vx = u[a].to_double() * w00 +
    u[b].to_double() * w10 +
    u[c].to_double() * w01 +
    u[d].to_double() * w11 +
    pm.ambient_x *
    (
      fx_u[a].to_double() * w00 +
      fx_u[b].to_double() * w10 +
      fx_u[c].to_double() * w01 +
      fx_u[d].to_double() * w11
    )
  pm.out_vy = v[a].to_double() * w00 +
    v[b].to_double() * w10 +
    v[c].to_double() * w01 +
    v[d].to_double() * w11 +
    pm.ambient_x *
    (
      fx_v[a].to_double() * w00 +
      fx_v[b].to_double() * w10 +
      fx_v[c].to_double() * w01 +
      fx_v[d].to_double() * w11
    ) +
    pm.ambient_y
}

///|
#export_name("outX")
pub fn out_x() -> Double {
  pm.out_vx
}

///|
#export_name("outY")
pub fn out_y() -> Double {
  pm.out_vy
}

// 感受到的总温度 = 场温 + 环境偏置（与浮力消费同一事实源）

// 4 抽头双线性（gx/gy 已 clamp 的格坐标）：操作数顺序固定 = 逐位契约，fluid/tracers 共用

///|
fn bilinear4(f : FixedArray[Float], nx : Int, gx : Double, gy : Double) -> Double {
  let i0 = gx.floor().to_int()
  let j0 = gy.floor().to_int()
  let fx = gx - i0.to_double()
  let fy = gy - j0.to_double()
  let a = i0 + j0 * nx
  f[a].to_double() * (1.0 - fx) * (1.0 - fy) +
  f[a + 1].to_double() * fx * (1.0 - fy) +
  f[a + nx].to_double() * (1.0 - fx) * fy +
  f[a + nx + 1].to_double() * fx * fy
}

///|
#export_name("sampleTemp")
pub fn sample_temp(wx : Double, wy : Double) -> Double {
  let nx = pm.nx
  let ny = pm.ny
  let mut gx = wx / pm.cell - 0.5 + pm.ox.to_double()
  let mut gy = wy / pm.cell - 0.5 + pm.oy.to_double()
  if gx < 0.0 {
    gx = 0.0
  } else if gx > nx.to_double() - 1.001 {
    gx = nx.to_double() - 1.001
  }
  if gy < 0.0 {
    gy = 0.0
  } else if gy > ny.to_double() - 1.001 {
    gy = ny.to_double() - 1.001
  }
  bilinear4(t, nx, gx, gy) + pm.ambient_t
}

///|
fn copy_fields() -> Unit {
  let bytes = pm.nx * pm.ny * 4
  mem_copy(addr_of_f32(u0), addr_of_f32(u), bytes)
  mem_copy(addr_of_f32(v0), addr_of_f32(v), bytes)
  mem_copy(addr_of_f32(t0), addr_of_f32(t), bytes)
}

// 单趟半拉格朗日平流：sign=1 回溯 / -1 前推（gather 无法向量化，天然标量）

// 单趟半拉格朗日平流 + 阻尼融合（MacCormack 补偿已移除：普通半拉格朗日固有耗散更大，
// 热羽流/烟迹更糊，但平流从 9 趟降为 3 趟）

///|
fn advect(
  dst : FixedArray[Float],
  src : FixedArray[Float],
  dt : Double,
  damping : Double,
) -> Unit {
  let nx = pm.nx
  let ny = pm.ny
  let dt0 = dt / pm.cell
  let ac = pm.air_count
  for m in 0..<ac {
    let idx = air_list[m]
    let mut x = air_i[m].to_double() - dt0 * u0[idx].to_double()
    let mut y = air_j[m].to_double() - dt0 * v0[idx].to_double()
    if x < 0.5 {
      x = 0.5
    } else if x > nx.to_double() - 1.5 {
      x = nx.to_double() - 1.5
    }
    if y < 0.5 {
      y = 0.5
    } else if y > ny.to_double() - 1.5 {
      y = ny.to_double() - 1.5
    }
    let i0 = x.to_int()
    let j0 = y.to_int()
    let fx = x - i0.to_double()
    let fy = y - j0.to_double()
    let a = i0 + j0 * nx
    let b = a + 1
    let c = a + nx
    let d = c + 1
    dst[idx] = Float::from_double(
      (src[a].to_double() * (1.0 - fx) * (1.0 - fy) +
      src[b].to_double() * fx * (1.0 - fy) +
      src[c].to_double() * (1.0 - fx) * fy +
      src[d].to_double() * fx * fy) *
      damping,
    )
  }
}

///|
fn apply_buoyancy(dt : Double) -> Unit {
  let k = pm.buoyancy * dt
  let a_t = pm.ambient_t
  let nx = pm.nx
  let ny = pm.ny
  for j in 1..<(ny - 1) {
    let row = j * nx
    for i in 1..<(nx - 1) {
      let idx = i + row
      v[idx] = Float::from_double(
        v[idx].to_double() - k * (t[idx].to_double() + a_t),
      )
    }
  }
}

// 边距吸收层：仅扫左/右/上三条边距带，系数随深入边距线性增强——开放大气的替身，
// 风与热流出地图后被吸收，不撞外壁反射回场内

///|
fn apply_sponge() -> Unit {
  let m = pm.margin_cells
  if m <= 0 {
    return
  }
  let nx = pm.nx
  let ny = pm.ny
  let md = m.to_double()
  for j in 1..<(ny - 1) {
    let row = j * nx
    for i in 1..<(m + 1) {
      let s = (md - i.to_double()) / md
      let kv = Float::from_double(
        pm.sponge_vel_in + (pm.sponge_vel_out - pm.sponge_vel_in) * s,
      )
      let kt = Float::from_double(1.0 + (pm.sponge_t_out - 1.0) * s)
      let l = i + row
      let r = nx - 1 - i + row
      u[l] = u[l] * kv
      v[l] = v[l] * kv
      t[l] = t[l] * kt
      u[r] = u[r] * kv
      v[r] = v[r] * kv
      t[r] = t[r] * kt
    }
  }
  for j in 1..<(m + 1) {
    let row = j * nx
    let s = (md - j.to_double()) / md
    let kv = Float::from_double(
      pm.sponge_vel_in + (pm.sponge_vel_out - pm.sponge_vel_in) * s,
    )
    let kt = Float::from_double(1.0 + (pm.sponge_t_out - 1.0) * s)
    for i in (m + 1)..<(nx - m - 1) {
      let idx = i + row
      u[idx] = u[idx] * kv
      v[idx] = v[idx] * kv
      t[idx] = t[idx] * kt
    }
  }
}

///|
fn project_div() -> Unit {
  let h = pm.cell
  let inv2h = 1.0 / (2.0 * h)
  let h2 = h * h
  let nx = pm.nx
  let ac = pm.air_count
  for m in 0..<ac {
    let idx = air_list[m]
    let u_r : Double = if solid[idx + 1] != b'\x00' {
      0.0
    } else {
      u[idx + 1].to_double()
    }
    let u_l : Double = if solid[idx - 1] != b'\x00' {
      0.0
    } else {
      u[idx - 1].to_double()
    }
    let v_d : Double = if solid[idx + nx] != b'\x00' {
      0.0
    } else {
      v[idx + nx].to_double()
    }
    let v_u : Double = if solid[idx - nx] != b'\x00' {
      0.0
    } else {
      v[idx - nx].to_double()
    }
    // f32 往返保留（与旧 div 数组 + 二次扫描逐位一致），直接产出 div_h2 省一趟扫描
    let d = Float::from_double((u_r - u_l + v_d - v_u) * inv2h)
    div_h2[idx] = h2 * d.to_double()
  }
}

// 红黑 Gauss-Seidel + warm-start 压强：同奇偶相内单元格互不依赖，
// 相内遍历顺序不影响读取值（air_even/odd 表行主序与旧逐行扫描等价）。
// bulk 主体格四邻全空气，免固体邻居检查直读；边界格走含固体替换的完整路径。
// 注：曾试 SOR 加速（ω=1.85、迭代 12→8），但其 SIMD 读同格写入目标（p_old）触发
// bun/JSC 误编译（Safari 同源风险），已回退 plain GS（见 pitfalls I8）

// GS 双格 SIMD 快路径：相邻同奇偶格（b=a+2）打包 f64x2 双车道，每车道独立格

// f32x4 抽 lane0/lane2 → f64x2：相距 2 格的元素对（横/竖邻居均非连续 f32，不能 load32x2）

///|
fn lanes02(v : V128) -> V128 {
  @v128.f64x2_promote_low_f32x4(
    @v128.i8x16_shuffle(v, v, 0, 1, 2, 3, 8, 9, 10, 11, 4, 5, 6, 7, 12, 13, 14, 15),
  )
}

///|
fn gs_pair(a : Int) -> Unit {
  let nx = pm.nx
  let off = a * 4
  // 车道 = 格 a / 格 b（a+2）的邻居对；横邻居跨两个相邻 f32x4（p[a-1..a+2]、p[a+1..a+4]）
  let v1 = v128_load4_f32(p, off - 4)
  let v2 = v128_load4_f32(p, off + 4)
  let ha = lanes02(v1)
  let hb = @v128.f64x2_promote_low_f32x4(
    @v128.i8x16_shuffle(v1, v2, 8, 9, 10, 11, 24, 25, 26, 27, 4, 5, 6, 7, 12, 13, 14, 15),
  )
  let h = @v128.f64x2_add(ha, hb)
  let vu = lanes02(v128_load4_f32(p, off - nx * 4))
  let vd = lanes02(v128_load4_f32(p, off + nx * 4))
  let t = @v128.f64x2_add(h, vu)
  let s = @v128.f64x2_add(t, vd)
  let d = v128_load1_f64_lane1(div_h2, (a + 2) * 8, v128_load1_f64(div_h2, a * 8))
  let s = @v128.f64x2_mul(@v128.f64x2_sub(s, d), @v128.f64x2_splat(0.25))
  let f = @v128.f32x4_demote_f64x2_zero(s)
  v128_store1_f32_lane0(p, off, f)
  v128_store1_f32_lane1(p, off + 8, f)
}

// GS 单格路径：bulk 快表达式 / 边界格固体替换

///|
fn gs_cell(idx : Int) -> Unit {
  let nx = pm.nx
  if bulk[idx] != b'\x00' {
    p[idx] = Float::from_double(
      (p[idx - 1].to_double() +
      p[idx + 1].to_double() +
      p[idx - nx].to_double() +
      p[idx + nx].to_double() - div_h2[idx]) *
      0.25,
    )
  } else {
    let p_l : Double = if solid[idx - 1] != b'\x00' {
      p[idx].to_double()
    } else {
      p[idx - 1].to_double()
    }
    let p_r : Double = if solid[idx + 1] != b'\x00' {
      p[idx].to_double()
    } else {
      p[idx + 1].to_double()
    }
    let p_u : Double = if solid[idx - nx] != b'\x00' {
      p[idx].to_double()
    } else {
      p[idx - nx].to_double()
    }
    let p_d : Double = if solid[idx + nx] != b'\x00' {
      p[idx].to_double()
    } else {
      p[idx + nx].to_double()
    }
    p[idx] = Float::from_double(
      (p_l + p_r + p_u + p_d - div_h2[idx]) * 0.25,
    )
  }
}

///|
fn project_gs() -> Unit {
  for _ in 0..<pm.iterations {
    for phase in 0..<2 {
      let list = if phase == 0 { air_even } else { air_odd }
      let n = if phase == 0 { pm.air_even_count } else { pm.air_odd_count }
      let mut k = 0
      while k < n {
        let a = list[k]
        // 相邻同奇偶双格（b=a+2 且双 bulk）打包 SIMD；否则逐格慢路径
        if k + 1 < n && list[k + 1] == a + 2 &&
          bulk[a] != b'\x00' && bulk[a + 2] != b'\x00' {
          gs_pair(a)
          k = k + 2
          continue
        }
        gs_cell(a)
        k = k + 1
      }
    }
  }
}

///|
fn project_grad() -> Unit {
  let inv2h = 1.0 / (2.0 * pm.cell)
  let nx = pm.nx
  let ac = pm.air_count
  for m in 0..<ac {
    let idx = air_list[m]
    let p_l : Double = if solid[idx - 1] != b'\x00' {
      p[idx].to_double()
    } else {
      p[idx - 1].to_double()
    }
    let p_r : Double = if solid[idx + 1] != b'\x00' {
      p[idx].to_double()
    } else {
      p[idx + 1].to_double()
    }
    let p_u : Double = if solid[idx - nx] != b'\x00' {
      p[idx].to_double()
    } else {
      p[idx - nx].to_double()
    }
    let p_d : Double = if solid[idx + nx] != b'\x00' {
      p[idx].to_double()
    } else {
      p[idx + nx].to_double()
    }
    u[idx] = Float::from_double(u[idx].to_double() - (p_r - p_l) * inv2h)
    v[idx] = Float::from_double(v[idx].to_double() - (p_d - p_u) * inv2h)
  }
}

///|
fn project() -> Unit {
  project_div()
  project_gs()
  project_grad()
}

///|
#export_name("step")
pub fn step(dt : Double) -> Unit {
  apply_buoyancy(dt)
  copy_fields()
  advect(u, u0, dt, pm.vel_damping)
  advect(v, v0, dt, pm.vel_damping)
  advect(t, t0, dt, pm.t_damping)
  apply_sponge()
  project()
  enforce_boundary()
}

///|
fn enforce_boundary() -> Unit {
  for k in 0..<pm.solid_count {
    let idx = solid_list[k]
    u[idx] = 0.0
    v[idx] = 0.0
    t[idx] = 0.0
  }
}

///|
#export_name("fieldU")
pub fn field_u() -> Int {
  addr_of_f32(u)
}

///|
#export_name("fieldV")
pub fn field_v() -> Int {
  addr_of_f32(v)
}

///|
#export_name("fieldT")
pub fn field_t() -> Int {
  addr_of_f32(t)
}

///|
#export_name("solidBuf")
pub fn solid_buf() -> Int {
  addr_of_u8(solid)
}

///|
#export_name("fieldFxU")
pub fn field_fx_u() -> Int {
  addr_of_f32(fx_u)
}

///|
#export_name("fieldFxV")
pub fn field_fx_v() -> Int {
  addr_of_f32(fx_v)
}
