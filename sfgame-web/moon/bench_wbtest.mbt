// 性能基线（moon bench，不进 moon test）：满网格流体步 + 分阶段拆解——优化决策的事实依据。
// 基线口径：空气索引表 + GS 双格 f64x2 SIMD + MacCormack 平流（位精确），256×160 满网格。

///|
test (b : @bench.T) {
  guard fluid_init(256, 160, 1.5, 2.0, 9.0, 3.4, 0.996, 0.99, 12, 0) == 0 else {
    fail("fluid_init 失败")
  }
  // 平原地形：底部 30 格固体
  for i in 0..<(256 * 160) {
    solid[i] = if i / 256 >= 130 { b'\x01' } else { b'\x00' }
  }
  rebuild_solid()
  set_ambient(0.3, 0.0, 0.0)
  // 预热：让场非零（真实数据形态，避免零场捷径）
  for _ in 0..<30 {
    add_heat(120.0, 100.0, 0.27)
    step(1.0 / 60.0)
  }
  b.bench(name="step-全流水线", fn() {
    add_heat(120.0, 100.0, 0.27)
    step(1.0 / 60.0)
  })
  b.bench(name="1-buoyancy", fn() { apply_buoyancy(1.0 / 60.0) })
  b.bench(name="2-copy-fields", fn() { copy_fields() })
  b.bench(name="3-advect-单场", fn() {
    advect_maccormack(u, u0, 1.0 / 60.0, 0.996)
  })
  b.bench(name="3a-pass-单趟", fn() { advect_pass(u, u0, 1.0 / 60.0, 1.0) })
  b.bench(name="4-div", fn() { project_div() })
  b.bench(name="5-gs-12迭代", fn() { project_gs() })
  b.bench(name="6-grad", fn() { project_grad() })
  b.bench(name="7-boundary", fn() { enforce_boundary() })
}

///|
test (b : @bench.T) {
  guard fluid_init(256, 160, 1.5, 2.0, 9.0, 3.4, 0.996, 0.99, 12, 7) == 0 else {
    fail("fluid_init 失败")
  }
  for i in 0..<(256 * 160) {
    solid[i] = if i / 256 >= 130 { b'\x01' } else { b'\x00' }
  }
  rebuild_solid()
  for _ in 0..<30 {
    add_heat(120.0, 100.0, 0.27)
    step(1.0 / 60.0)
  }
  b.bench(name="sponge-边距7格", fn() { apply_sponge() })
}
