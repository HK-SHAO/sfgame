// 性能基线（moon bench，不进 moon test）：满网格流体步——内核性能唯一持续度量点。
// 满网格基线：空气索引表 + GS 双格 f64x2 SIMD + MacCormack 平流（位精确），
// 标量迁移起点 1.16× AS SIMD 后再 -30%（256×160，2026-08 实测）

///|
test (b : @bench.T) {
  guard fluid_init(256, 160, 1.5, 2.0, 9.0, 18.0, 3.4, 0.996, 0.99, 12, 0) == 0 else {
    fail("fluid_init 失败")
  }
  // 平原地形：底部 30 格固体
  for i in 0..<(256 * 160) {
    solid[i] = if i / 256 >= 130 { b'\x01' } else { b'\x00' }
  }
  rebuild_solid()
  set_ambient(0.3, 0.0, 0.0)
  b.bench(name="fluid-step-256x160", fn() {
    add_heat(120.0, 100.0, 0.27)
    step(1.0 / 60.0)
  })
}
