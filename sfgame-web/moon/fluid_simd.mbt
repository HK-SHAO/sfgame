// GS 双格 SIMD 快路径（自 fluid.mbt 拆分，与标量逐位等价，白盒测试守护）：
// 红黑相位内同奇偶格互不依赖，相邻同奇偶两格（b = a+2）打包 f64x2 双车道，每车道独立更新。
// 字节序推导：f32 数组里相距 2 格的两个值不相邻（跨 8 字节），不能 load32x2 直取——
// lanes02(v) 用 i8x16_shuffle 把 v 的 lane0/1（字节 0..7）与 lane2/3（字节 8..15）前移拼成
// 低 16 字节，再 promote 成两个 f64 车道；横邻居对跨两个相邻 f32x4（p[a-1..a+2] 与 p[a+1..a+4]），
// hb 的 shuffle 从 v1 取字节 8..11、从 v2 取字节 24..27（即 v2 的 lane0）各组成一对。
// gs_pair：4 个 f64x2 邻居对求和 → 减 div_h2 车道对 → ×0.25 → demote 回 f32x4 → lane0/lane1 写回两格

///|
fn lanes02(v : V128) -> V128 {
  @v128.f64x2_promote_low_f32x4(
    @v128.i8x16_shuffle(
      v, v, 0, 1, 2, 3, 8, 9, 10, 11, 4, 5, 6, 7, 12, 13, 14, 15,
    ),
  )
}

///|
fn gs_pair(a : Int) -> Unit {
  let nx = pm.nx
  let off = a * 4
  let v1 = v128_load4_f32(p, off - 4)
  let v2 = v128_load4_f32(p, off + 4)
  let ha = lanes02(v1)
  let hb = @v128.f64x2_promote_low_f32x4(
    @v128.i8x16_shuffle(
      v1, v2, 8, 9, 10, 11, 24, 25, 26, 27, 4, 5, 6, 7, 12, 13, 14, 15,
    ),
  )
  let h = @v128.f64x2_add(ha, hb)
  let vu = lanes02(v128_load4_f32(p, off - nx * 4))
  let vd = lanes02(v128_load4_f32(p, off + nx * 4))
  let t = @v128.f64x2_add(h, vu)
  let s = @v128.f64x2_add(t, vd)
  let d = v128_load1_f64_lane1(
    div_h2,
    (a + 2) * 8,
    v128_load1_f64(div_h2, a * 8),
  )
  let s = @v128.f64x2_mul(@v128.f64x2_sub(s, d), @v128.f64x2_splat(0.25))
  let f = @v128.f32x4_demote_f64x2_zero(s)
  v128_store1_f32_lane0(p, off, f)
  v128_store1_f32_lane1(p, off + 8, f)
}

///|
fn buoyancy2(k : Double, a_t : Double) -> Unit {
  let nx = pm.nx
  let ny = pm.ny
  let kv = @v128.f64x2_splat(k)
  let av = @v128.f64x2_splat(a_t)
  let last = nx - 2
  for j in 1..<(ny - 1) {
    let row = j * nx
    let mut i = 1
    while i + 1 <= last {
      let idx = i + row
      let vp = @v128.f64x2_promote_low_f32x4(v128_load4_f32(v, idx * 4))
      let tp = @v128.f64x2_promote_low_f32x4(v128_load4_f32(t, idx * 4))
      let s = @v128.f64x2_sub(vp, @v128.f64x2_mul(kv, @v128.f64x2_add(tp, av)))
      let f = @v128.f32x4_demote_f64x2_zero(s)
      v128_store1_f32_lane0(v, idx * 4, f)
      v128_store1_f32_lane1(v, (idx + 1) * 4, f)
      i = i + 2
    }
    if i <= last {
      let idx = i + row
      v[idx] = Float::from_double(
        v[idx].to_double() - k * (t[idx].to_double() + a_t),
      )
    }
  }
}
