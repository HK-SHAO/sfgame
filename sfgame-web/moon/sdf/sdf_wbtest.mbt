// 白盒：sdf 求值器内核自洽（宿主侧语义另有 tests/level-format.test.ts 经门面覆盖、
// tests/sdf-golden.test.ts 位级基线覆盖）

///|
test "四则/变量/一元" {
  @test.assert_eq(compile("x + 2")(3.0, 0.0), 5.0)
  @test.assert_eq(compile("-(x - 1)")(5.0, 0.0), -4.0)
  @test.assert_eq(compile("y - x")(3.0, 10.0), 7.0)
  @test.assert_eq(compile("2 * x / 4")(6.0, 0.0), 3.0)
}

///|
test "函数库语义抽样" {
  @test.assert_eq(compile("clamp(x, 0, 2)")(5.0, 0.0), 2.0)
  @test.assert_eq(compile("smoothstep(x)")(0.5, 0.0), 0.5)
  @test.assert_eq(compile("abs(x) * sqrt(4)")(3.0, 0.0), 6.0)
  @test.assert_eq(compile("min(x, y)")(3.0, 7.0), 3.0)
  @test.assert_eq(compile("flat(40)")(3.0, 38.0), 2.0)
  @test.assert_eq(compile("circle(20, 30, 5)")(20.0, 30.0), -5.0)
  @test.assert_eq(compile("box(10, 20, 3, 4)")(10.0, 20.0), -3.0)
}

///|
test "ss 别名与未知函数查表" {
  match fn_of("ss") {
    Some(FSmoothstep) => ()
    _ => fail("ss 应映射到 FSmoothstep")
  }
  match fn_of("foo") {
    None => ()
    _ => fail("foo 应未知")
  }
}

///|
test "数字字面量形态" {
  @test.assert_eq(compile(".5")(0.0, 0.0), 0.5)
  @test.assert_eq(compile("1e3")(0.0, 0.0), 1000.0)
  @test.assert_eq(compile("2.5e-1")(0.0, 0.0), 0.25)
}
