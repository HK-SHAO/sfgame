// 白盒：ffi 裸内存原语（包内可见 priv）。宿主侧寻址约定由 tests/mbt-engine.test.ts 端到端校验，
// 此处只测 mem_fill/mem_copy 的字节语义

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
