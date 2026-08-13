// Wasm 底层原语（内联 WAT）。寻址约定：FixedArray 经 #borrow 传入内联 WAT 时，
// i32 参数即数据区首地址（wasm 后端装箱传递表示，数据前头部在负偏移）——内核缓冲一律静态容量
// FixedArray，宿主以导出地址建 typed view 零拷贝读写。该约定非文档化 ABI，由宿主握手测试
// 由宿主握手测试（tests/engine-wasm.test.ts）与引擎位稳定性基线（tests/engine-golden.test.ts）守护，
// 工具链升级若变更布局会响亮失败，绝不静默。

///|
#borrow(a)
extern "wasm" fn addr_of_f32(a : FixedArray[Float]) -> Int =
  #|(func (param i32) (result i32) local.get 0)

///|
#borrow(a)
extern "wasm" fn addr_of_i32(a : FixedArray[Int]) -> Int =
  #|(func (param i32) (result i32) local.get 0)

///|
#borrow(a)
extern "wasm" fn addr_of_u8(a : FixedArray[Byte]) -> Int =
  #|(func (param i32) (result i32) local.get 0)

///|
extern "wasm" fn mem_fill(dst : Int, c : Int, n : Int) -> Unit =
  #|(func (param i32 i32 i32)
  #|  local.get 0
  #|  local.get 1
  #|  local.get 2
  #|  memory.fill)

///|
extern "wasm" fn mem_copy(dst : Int, src : Int, n : Int) -> Unit =
  #|(func (param i32 i32 i32)
  #|  local.get 0
  #|  local.get 1
  #|  local.get 2
  #|  memory.copy)

// SIMD 位精确内存原语（GS 双格快路径）：v128.load 系指令全部支持非对齐访问。
// 入参 off 为字节偏移（调用方按元素宽 ×4/×8 折算）；地址 = 数组数据区首 + off

///|
#borrow(a)
extern "wasm" fn v128_load4_f32(a : FixedArray[Float], off : Int) -> V128 =
  #|(func (param i32 i32) (result v128)
  #|  local.get 0
  #|  local.get 1
  #|  i32.add
  #|  v128.load)

///|
#borrow(a)
extern "wasm" fn v128_load1_f64(a : FixedArray[Double], off : Int) -> V128 =
  #|(func (param i32 i32) (result v128)
  #|  local.get 0
  #|  local.get 1
  #|  i32.add
  #|  v128.load64_zero)

///|
#borrow(a)
extern "wasm" fn v128_load1_f64_lane1(
  a : FixedArray[Double],
  off : Int,
  v : V128,
) -> V128 =
  #|(func (param i32 i32 v128) (result v128)
  #|  local.get 0
  #|  local.get 1
  #|  i32.add
  #|  local.get 2
  #|  v128.load64_lane 1)

///|
#borrow(a)
extern "wasm" fn v128_store1_f32_lane0(
  a : FixedArray[Float],
  off : Int,
  v : V128,
) -> Unit =
  #|(func (param i32 i32 v128)
  #|  local.get 0
  #|  local.get 1
  #|  i32.add
  #|  local.get 2
  #|  v128.store32_lane 0)

///|
#borrow(a)
extern "wasm" fn v128_store1_f32_lane1(
  a : FixedArray[Float],
  off : Int,
  v : V128,
) -> Unit =
  #|(func (param i32 i32 v128)
  #|  local.get 0
  #|  local.get 1
  #|  i32.add
  #|  local.get 2
  #|  v128.store32_lane 1)
