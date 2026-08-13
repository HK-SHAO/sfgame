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
