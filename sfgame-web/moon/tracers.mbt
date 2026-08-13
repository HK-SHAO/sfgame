// 示踪粒子内核（assembly/tracers.ts 的 Moonbit 同构移植）：粒子状态全量驻留 wasm 内存，
// 宿主每 tick 只写热源表并单次调用推进——风场采样直调流体（同包零跨界）、地形走宿主烘焙 SDF 场。
// 粒子纯视觉不涉判定：PRNG 用确定性 mulberry32（宿主播种），与 AS 位级一致。

///|
let t_count : Int = 400

///|
let t_trail_len : Int = 24

///|
let t_trail_sample : Double = 0.45

///|
let t_respawn_tries : Int = 8

///|
let t_plume_radius : Double = 1.6

///|
let t_plume_life_min : Double = 0.9

///|
let t_plume_life_span : Double = 1.2
// 自然死亡转生羽流的概率：稳态羽流密度 ≈ 死亡率×概率×羽流寿命，与原强夺式注入同量级

///|
let t_plume_chance : Double = 0.7

///|
let t_plume_tries : Int = 4
// 地形场容量 = 流体网格上限（grid.mbt 单点），超限 init 拒绝

///|
let sdf_capacity : Int = grid_max_cells

///|
let src_capacity : Int = 32

///|
let tx : FixedArray[Float] = FixedArray::make(t_count, 0.0)

///|
let ty : FixedArray[Float] = FixedArray::make(t_count, 0.0)

///|
let t_life : FixedArray[Float] = FixedArray::make(t_count, 0.0)

///|
let t_max_life : FixedArray[Float] = FixedArray::make(t_count, 0.0)

///|
let t_odo : FixedArray[Float] = FixedArray::make(t_count, 0.0)

///|
let t_last_odo : FixedArray[Float] = FixedArray::make(t_count, 0.0)

///|
let trail_x : FixedArray[Float] = FixedArray::make(t_count * t_trail_len, 0.0)

///|
let trail_y : FixedArray[Float] = FixedArray::make(t_count * t_trail_len, 0.0)

///|
let trail_t : FixedArray[Float] = FixedArray::make(t_count * t_trail_len, 0.0)

///|
let trail_n : FixedArray[Byte] = FixedArray::make(t_count, b'\x00')
// 地形 SDF 场：宿主烘焙后原样上传（与流体掩码/飞机碰撞同源），格心值、双线性采样

///|
let t_sdf : FixedArray[Float] = FixedArray::make(sdf_capacity, 0.0)

///|
let src_buf : FixedArray[Float] = FixedArray::make(src_capacity * 2, 0.0)

///|
priv struct TState {
  mut time : Double
  mut world_w : Double
  mut world_h : Double
  mut margin : Double
  mut snx : Int
  mut sny : Int
  mut scell : Double
  mut sox : Double
  mut soy : Double
  mut rng_state : UInt
  mut src_now : Int
}

///|
let ts : TState = TState::{
  time: 0.0,
  world_w: 0.0,
  world_h: 0.0,
  margin: 0.0,
  snx: 0,
  sny: 0,
  scell: 1.0,
  sox: 0.0,
  soy: 0.0,
  rng_state: 0x9e3779b9U,
  src_now: 0,
}

// mulberry32：UInt 算术自然回绕、>> 为逻辑右移，与 JS/AS 的 imul + >>> 位级等价

///|
fn rnd() -> Double {
  ts.rng_state = ts.rng_state + 0x6d2b79f5U
  let mut z = ts.rng_state
  z = (z ^ (z >> 15)) * (z | 1U)
  z = z ^ (z + (z ^ (z >> 7)) * (z | 61U))
  (z ^ (z >> 14)).to_double() / 4294967296.0
}

// 双线性采样烘焙场：clamp 约定与流体 sample 同构（域外取边缘值 = 地形延展）

///|
fn sdf_at(x : Double, y : Double) -> Double {
  let mut gx = x / ts.scell - 0.5 + ts.sox
  let mut gy = y / ts.scell - 0.5 + ts.soy
  if gx < 0.0 {
    gx = 0.0
  } else if gx > ts.snx.to_double() - 1.001 {
    gx = ts.snx.to_double() - 1.001
  }
  if gy < 0.0 {
    gy = 0.0
  } else if gy > ts.sny.to_double() - 1.001 {
    gy = ts.sny.to_double() - 1.001
  }
  bilinear4(t_sdf, ts.snx, gx, gy)
}

///|
fn reset_trail(i : Int) -> Unit {
  t_odo[i] = 0.0
  t_last_odo[i] = 0.0
  trail_n[i] = b'\x00'
}

///|
fn record_trail(i : Int) -> Unit {
  let base = i * t_trail_len
  let n = trail_n[i].to_int()
  if n < t_trail_len {
    trail_x[base + n] = tx[i]
    trail_y[base + n] = ty[i]
    trail_t[base + n] = Float::from_double(ts.time)
    trail_n[i] = (n + 1).to_byte()
  } else {
    for k in 0..<(t_trail_len - 1) {
      trail_x[base + k] = trail_x[base + k + 1]
      trail_y[base + k] = trail_y[base + k + 1]
      trail_t[base + k] = trail_t[base + k + 1]
    }
    trail_x[base + t_trail_len - 1] = tx[i]
    trail_y[base + t_trail_len - 1] = ty[i]
    trail_t[base + t_trail_len - 1] = Float::from_double(ts.time)
  }
  t_last_odo[i] = t_odo[i]
}

// 有热源时自然死亡按概率转生为羽流：粒子本已淡出完毕，无 alpha 突变；
// 旧式强夺活粒子会让被夺者可见轨迹瞬消

///|
fn respawn(i : Int, scatter : Bool) -> Unit {
  if !scatter && ts.src_now > 0 && rnd() < t_plume_chance {
    for _ in 0..<t_plume_tries {
      let s = (rnd() * ts.src_now.to_double()).to_int()
      let ang = rnd() * @math.PI * 2.0
      let rad = rnd() * t_plume_radius
      let x = src_buf[s * 2].to_double() + @math.cos(ang) * rad
      let y = src_buf[s * 2 + 1].to_double() + @math.sin(ang) * rad
      if sdf_at(x, y) < 0.6 || y < 1.0 {
        continue
      }
      tx[i] = Float::from_double(x)
      ty[i] = Float::from_double(y)
      t_max_life[i] = Float::from_double(
        t_plume_life_min + rnd() * t_plume_life_span,
      )
      t_life[i] = t_max_life[i]
      reset_trail(i)
      record_trail(i)
      return
    }
  }
  for _ in 0..<t_respawn_tries {
    // 拒绝采样：全场随机投点，落在离地表 ≥1.5 的空气区才出生（SDF 天然兼容任意地形）
    let x = 0.5 + rnd() * (ts.world_w - 1.0)
    let y = 2.0 + rnd() * (ts.world_h - 3.0)
    if sdf_at(x, y) < 1.5 {
      continue
    }
    tx[i] = Float::from_double(x)
    ty[i] = Float::from_double(y)
    t_max_life[i] = Float::from_double(2.5 + rnd() * 4.0)
    t_life[i] = if scatter {
      Float::from_double(rnd() * t_max_life[i].to_double())
    } else {
      t_max_life[i]
    }
    reset_trail(i)
    // 出生即记首段轨迹：左缘粒子出生即被风带走，延迟会墙边留空
    record_trail(i)
    return
  }
  tx[i] = -100.0
  ty[i] = -100.0
  t_life[i] = 0.1
  reset_trail(i)
}

// SDF 场须先由宿主写入 t_sdf 再调用；count/trailLen/场容量与编译期容量不符返回非 0（拒绝创建）

///|
#export_name("tracersInit")
pub fn tracers_init(
  count : Int,
  trail_len : Int,
  world_w : Double,
  world_h : Double,
  margin : Double,
  snx : Int,
  sny : Int,
  scell : Double,
  sox : Double,
  soy : Double,
  seed : UInt,
) -> Int {
  if count != t_count || trail_len != t_trail_len {
    return 1
  }
  // scell 非正/NaN（采样除零/NaN 场）拒绝；!(>0) 同时捕获 NaN（NaN 比较恒 false）
  if snx < 2 || sny < 2 || snx * sny > sdf_capacity || !(scell > 0.0) {
    return 2
  }
  ts.world_w = world_w
  ts.world_h = world_h
  ts.margin = margin
  ts.snx = snx
  ts.sny = sny
  ts.scell = scell
  ts.sox = sox
  ts.soy = soy
  ts.rng_state = seed
  ts.time = 0.0
  for i in 0..<t_count {
    respawn(i, true)
  }
  0
}

///|
#export_name("tracersStep")
pub fn tracers_step(dt : Double, src_count : Int) -> Unit {
  ts.time = ts.time + dt
  ts.src_now = src_count
  let m = ts.margin
  for i in 0..<t_count {
    t_life[i] = Float::from_double(t_life[i].to_double() - dt)
    if t_life[i].to_double() <= 0.0 {
      respawn(i, false)
      continue
    }
    sample_velocity(tx[i].to_double(), ty[i].to_double())
    let nx = tx[i].to_double() + (out_x() + (rnd() - 0.5) * 0.5) * dt
    let ny = ty[i].to_double() + (out_y() + (rnd() - 0.5) * 0.5) * dt
    let dx = nx - tx[i].to_double()
    let dy = ny - ty[i].to_double()
    t_odo[i] = Float::from_double(
      t_odo[i].to_double() + (dx * dx + dy * dy).sqrt(),
    )
    tx[i] = Float::from_double(nx)
    ty[i] = Float::from_double(ny)
    if t_odo[i].to_double() - t_last_odo[i].to_double() >= t_trail_sample {
      record_trail(i)
    }
    // 允许飞出地图：边距内继续随风流动，接近末端才清理；进地即重生
    if sdf_at(nx, ny) < 0.4 ||
      ny < 1.0 - m ||
      nx < 1.0 - m ||
      nx > ts.world_w + m - 1.0 {
      respawn(i, false)
    }
  }
}

///|
#export_name("tTime")
pub fn t_time() -> Double {
  ts.time
}

///|
#export_name("tXBuf")
pub fn t_x_buf() -> Int {
  addr_of_f32(tx)
}

///|
#export_name("tYBuf")
pub fn t_y_buf() -> Int {
  addr_of_f32(ty)
}

///|
#export_name("tLifeBuf")
pub fn t_life_buf() -> Int {
  addr_of_f32(t_life)
}

///|
#export_name("tMaxLifeBuf")
pub fn t_max_life_buf() -> Int {
  addr_of_f32(t_max_life)
}

///|
#export_name("tTrailXBuf")
pub fn t_trail_x_buf() -> Int {
  addr_of_f32(trail_x)
}

///|
#export_name("tTrailYBuf")
pub fn t_trail_y_buf() -> Int {
  addr_of_f32(trail_y)
}

///|
#export_name("tTrailTBuf")
pub fn t_trail_t_buf() -> Int {
  addr_of_f32(trail_t)
}

///|
#export_name("tTrailNBuf")
pub fn t_trail_n_buf() -> Int {
  addr_of_u8(trail_n)
}

///|
#export_name("tSdfBuf")
pub fn t_sdf_buf() -> Int {
  addr_of_f32(t_sdf)
}

///|
#export_name("tSdfCap")
pub fn t_sdf_cap() -> Int {
  sdf_capacity
}

///|
#export_name("tSrcBuf")
pub fn t_src_buf() -> Int {
  addr_of_f32(src_buf)
}

///|
#export_name("tSrcCap")
pub fn t_src_cap() -> Int {
  src_capacity
}
