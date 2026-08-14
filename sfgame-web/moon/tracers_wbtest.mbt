// 白盒：示踪粒子内核不变量（宿主侧行为由 tests/tracers.test.ts 守护，
// 且已证与 assembly 逐位一致；此处只测参数校验与 RNG 确定性）

///|
test "tracers_init 参数校验" {
  @test.assert_eq(
    tracers_init(399, 24, 72.0, 54.0, 0.0, 48, 36, 1.5, 0.0, 0.0, 1U),
    1,
  )
  @test.assert_eq(
    tracers_init(400, 23, 72.0, 54.0, 0.0, 48, 36, 1.5, 0.0, 0.0, 1U),
    1,
  )
  @test.assert_eq(
    tracers_init(400, 24, 72.0, 54.0, 0.0, 300, 300, 1.5, 0.0, 0.0, 1U),
    2,
  )
}

///|
test "mulberry32 同种子序列确定" {
  ts.rng_state = 0x9e3779b9U
  let a1 = rnd()
  let a2 = rnd()
  ts.rng_state = 0x9e3779b9U
  let b1 = rnd()
  let b2 = rnd()
  @test.assert_eq(a1, b1)
  @test.assert_eq(a2, b2)
  // 值域 [0, 1)
  guard a1 >= 0.0 && a1 < 1.0 else { fail("rnd 应落在 [0,1)") }
}

///|
test "触地 = 就地淡出而非即时重生（死亡路径归一，2026-08-14）" {
  let st = tracers_init(400, 24, 72.0, 54.0, 0.0, 48, 36, 1.5, 0.0, 0.0, 1U)
  @test.assert_eq(st, 0)
  let fs = fluid_init(48, 36, 1.5, 2.0, 9.0, 3.4, 0.997, 0.99, 12, 6)
  @test.assert_eq(fs, 0)
  for k in 0..<(48 * 36) {
    t_sdf[k] = if k / 48 >= 30 { -1.0 } else { 1.0 }
  }
  tx[0] = 36.0
  ty[0] = 45.0
  t_life[0] = 5.0
  t_max_life[0] = 5.0
  reset_trail(0)
  tracers_step(1.0 / 60.0, 0)
  @test.assert_eq(t_life[0], Float::from_double(0.7))
  @test.assert_eq(tx[0], 36.0)
  @test.assert_eq(ty[0], 45.0)
  @test.assert_eq(t_max_life[0], 5.0)
  for _ in 0..<60 {
    tracers_step(1.0 / 60.0, 0)
  }
  guard ty[0].to_double() < 44.0 else { fail("淡出后应重生到空气区") }
}
