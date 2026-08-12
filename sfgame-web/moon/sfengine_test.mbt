// 黑盒：公共 API 行为

///|
test "canary 读写回环" {
  canary_set(0, 1234567)
  canary_set(3, -42)
  @test.assert_eq(canary_get(0), 1234567)
  @test.assert_eq(canary_get(3), -42)
  @test.assert_eq(canary_len(), 4)
}
