// Wasm 底层原语（内联 WAT）。寻址约定：FixedArray 经 #borrow 传入内联 WAT 时，
// i32 参数即数据区首地址（wasm 后端装箱传递表示，数据前头部在负偏移）——内核缓冲一律静态容量
// FixedArray，宿主以导出地址建 typed view 零拷贝读写。该约定非文档化 ABI，由宿主握手测试
// （tests/mbt-engine.test.ts）与流体对拍（tests/mbt-fluid-parity.test.ts）双向校验，
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
