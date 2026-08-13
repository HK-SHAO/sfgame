// 白盒：顶点批内核不变量（宿主侧行为由 tests/batch.test.ts 守护，
// 且已证与 assembly 逐位一致；此处只测内核自洽结构）

///|
test "b_rect 产出 6 顶点且坐标/颜色正确" {
  b_reset()
  b_rect(1.0, 2.0, 3.0, 4.0, 0.5, 0.6, 0.7, 1.0)
  @test.assert_eq(b_count(), 6)
  // 首顶点 = (x0, y0)
  @test.assert_eq(data[0], 1.0)
  @test.assert_eq(data[1], 2.0)
  @test.assert_eq(data[2], 0.5)
  // 末顶点 = (x0, y1)
  let o = 5 * vertex_stride
  @test.assert_eq(data[o], 1.0)
  @test.assert_eq(data[o + 1], 4.0)
}

///|
test "b_tri 产出 3 顶点" {
  b_reset()
  b_tri(0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0)
  @test.assert_eq(b_count(), 3)
}

///|
test "b_disc 退化半径不产出顶点" {
  b_reset()
  b_disc(0.0, 0.0, 0.0, 5.0, 0.0, 12, 1.0, 1.0, 1.0, 1.0)
  @test.assert_eq(b_count(), 0)
  b_disc(0.0, 0.0, 5.0, 5.0, 0.0, 12, 1.0, 1.0, 1.0, 0.0)
  @test.assert_eq(b_count(), 0)
}

///|
test "b_terrain_field 拒绝非法参数" {
  @test.assert_eq(
    b_terrain_field(1, 5, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0),
    1,
  )
  @test.assert_eq(
    b_terrain_field(5, 5, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
    1,
  )
  @test.assert_eq(
    b_terrain_field(5, 5, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0),
    0,
  )
}

///|
test "容量常量对齐宿主契约" {
  @test.assert_eq(b_capacity(), 262152)
  @test.assert_eq(b_pts_cap(), 2048)
  @test.assert_eq(b_fade_cap(), 1024)
  @test.assert_eq(b_tracer_cap(), 400)
  @test.assert_eq(b_tracer_stride(), 80)
  @test.assert_eq(b_terrain_field_cap(), grid_max_cells)
  @test.assert_eq(b_terrain_cap(), grid_terrain_verts)
}
