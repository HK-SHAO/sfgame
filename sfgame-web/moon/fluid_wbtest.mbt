// 白盒：流体内核不变量（宿主侧行为由 tests/fluid.test.ts 与 engine-golden 守护，此处只测内核自洽性）。
// 内核状态为全局单例，每个测试先 reset 到干净网格

///|
fn reset(nx : Int, ny : Int) -> Unit raise {
  @test.assert_eq(fluid_init(nx, ny, 1.5, 2.0, 9.0, 3.4, 0.996, 0.99, 12, 0), 0)
  for i in 0..<(nx * ny) {
    solid[i] = b'\x00'
  }
  rebuild_solid()
}

///|
test "init 拒绝超容量/非法网格" {
  @test.assert_eq(fluid_init(2, 36, 1.5, 2.0, 9.0, 3.4, 0.996, 0.99, 12, 0), 1)
  @test.assert_eq(
    fluid_init(257, 36, 1.5, 2.0, 9.0, 3.4, 0.996, 0.99, 12, 0),
    1,
  )
  @test.assert_eq(
    fluid_init(48, 161, 1.5, 2.0, 9.0, 3.4, 0.996, 0.99, 12, 0),
    1,
  )
}

///|
test "clear 清零状态场" {
  reset(24, 18)
  add_heat(18.75, 14.25, 5.0)
  step(1.0 / 60.0)
  clear()
  @test.assert_eq(sample_temp(18.75, 14.25), 0.0)
  sample_velocity(18.75, 14.25)
  @test.assert_eq(out_x(), 0.0)
  @test.assert_eq(out_y(), 0.0)
}

///|
test "add_heat 钳制在 ±t_max 内" {
  reset(24, 18)
  // 世界坐标 (18.75, 14.25) = 格心 (12, 9)（gx = wx/cell - 0.5）
  add_heat(18.75, 14.25, 1000.0)
  @test.assert_eq(sample_temp(18.75, 14.25), 9.0)
  add_heat(18.75, 14.25, -3000.0)
  @test.assert_eq(sample_temp(18.75, 14.25), -9.0)
}

///|
test "固体格速度/温度恒零（注入被拒 + enforce_boundary）" {
  reset(24, 18)
  let idx = 12 + 9 * 24
  solid[idx] = b'\x01'
  rebuild_solid()
  add_heat(18.75, 14.25, 100.0)
  add_force(18.75, 14.25, 1.0, 0.0, 5.0, 3.0)
  for _ in 0..<30 {
    step(1.0 / 60.0)
  }
  @test.assert_eq(t[idx], 0.0)
  @test.assert_eq(u[idx], 0.0)
  @test.assert_eq(v[idx], 0.0)
}

///|
test "热源产生上升风（y 向下，上升 = v < 0）" {
  reset(48, 36)
  for _ in 0..<120 {
    add_heat(36.0, 38.0, 16.0 / 60.0)
    step(1.0 / 60.0)
  }
  sample_velocity(36.0, 32.0)
  guard out_y() < 0.0 else { fail("热源上方应为上升风（v < 0）") }
}

// 白盒：GS SIMD 双格快路径（gs_pair）与标量逐位一致——shuffle/车道打包任何漂移都响亮失败

///|
fn scalar_gs_one(idx : Int) -> Unit {
  let nx = pm.nx
  p[idx] = Float::from_double(
    (
      p[idx - 1].to_double() +
      p[idx + 1].to_double() +
      p[idx - nx].to_double() +
      p[idx + nx].to_double() -
      div_h2[idx]
    ) *
    0.25,
  )
}

///|
test "gs_pair SIMD 与标量逐位一致" {
  let _ = fluid_init(20, 12, 1.5, 2.0, 9.0, 3.4, 0.996, 0.99, 12, 0)
  for i in 0..<(20 * 12) {
    solid[i] = b'\x00'
  }
  rebuild_solid()
  let mut seed = 12345
  for i in 0..<(20 * 12) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    p[i] = Float::from_double((seed % 1000).to_double() / 7.0 - 50.0)
    div_h2[i] = (seed % 997).to_double() / 3.0 - 100.0
  }
  let a = air_even[0]
  let s0 = p[a].to_double()
  let s1 = p[a + 2].to_double()
  scalar_gs_one(a)
  scalar_gs_one(a + 2)
  let r0 = p[a].to_double()
  let r1 = p[a + 2].to_double()
  p[a] = Float::from_double(s0)
  p[a + 2] = Float::from_double(s1)
  gs_pair(a)
  if p[a].to_double() != r0 || p[a + 2].to_double() != r1 {
    fail(
      "SIMD lane0=" +
      p[a].to_double().to_string() +
      " 标量=" +
      r0.to_string() +
      " lane1=" +
      p[a + 2].to_double().to_string() +
      " 标量=" +
      r1.to_string(),
    )
  }
}
