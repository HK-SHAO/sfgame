// 白盒：ffi 原语与寻址约定（包内可见 priv）

///|
test "canary 地址 peek/poke 与索引访问同一存储" {
  let base = canary_buf()
  poke_i32(base + 8, 77)
  @test.assert_eq(canary_get(2), 77)
  canary_set(1, 88)
  @test.assert_eq(peek_i32(base + 4), 88)
}

///|
test "mem_fill / mem_copy 裸内存语义" {
  let a : FixedArray[Byte] = FixedArray::make(16, b'\x00')
  let b : FixedArray[Byte] = FixedArray::make(16, b'\x00')
  let pa = addr_of_u8(a)
  let pb = addr_of_u8(b)
  mem_fill(pa + 4, 0xAB, 8)
  mem_copy(pb, pa, 16)
  @test.assert_eq(b[3], b'\x00')
  @test.assert_eq(b[4], b'\xAB')
  @test.assert_eq(b[11], b'\xAB')
  @test.assert_eq(b[12], b'\x00')
}

///|
test "f32/f64 peek/poke 字节地址直读" {
  let f : FixedArray[Float] = FixedArray::make(2, 0.0)
  let d : FixedArray[Double] = FixedArray::make(2, 0.0)
  poke_f32(addr_of_f32(f) + 4, 2.5)
  poke_f64(addr_of_f64(d), 1.25)
  @test.assert_eq(f[1], 2.5)
  @test.assert_eq(d[0], 1.25)
  @test.assert_eq(peek_f32(addr_of_f32(f) + 4), 2.5)
  @test.assert_eq(peek_f64(addr_of_f64(d)), 1.25)
}
