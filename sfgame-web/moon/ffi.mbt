// Wasm 底层原语（内联 WAT）。寻址约定：FixedArray 经 #borrow 传入内联 WAT 时，
// i32 参数即数据区首地址（wasm 后端装箱传递表示，数据前头部在负偏移）——内核缓冲一律静态容量
// FixedArray，宿主以导出地址建 typed view 零拷贝读写。该约定非文档化 ABI，由宿主握手测试
// （tests/mbt-engine.test.ts）双向校验，工具链升级若变更布局会响亮失败，绝不静默。

///|
#borrow(a)
extern "wasm" fn addr_of_f32(a : FixedArray[Float]) -> Int =
  #|(func (param i32) (result i32) local.get 0)

///|
#borrow(a)
extern "wasm" fn addr_of_f64(a : FixedArray[Double]) -> Int =
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

// peek/poke 按字节地址裸读写：握手校验与调试用，热路径走 FixedArray 索引（后端直接生成 load/store）

///|
extern "wasm" fn peek_i32(p : Int) -> Int =
  #|(func (param i32) (result i32) local.get 0 i32.load)

///|
extern "wasm" fn poke_i32(p : Int, v : Int) -> Unit =
  #|(func (param i32 i32) local.get 0 local.get 1 i32.store)

///|
extern "wasm" fn peek_f32(p : Int) -> Float =
  #|(func (param i32) (result f32) local.get 0 f32.load)

///|
extern "wasm" fn poke_f32(p : Int, v : Float) -> Unit =
  #|(func (param i32 f32) local.get 0 local.get 1 f32.store)

///|
extern "wasm" fn peek_f64(p : Int) -> Double =
  #|(func (param i32) (result f64) local.get 0 f64.load)

///|
extern "wasm" fn poke_f64(p : Int, v : Double) -> Unit =
  #|(func (param i32 f64) local.get 0 local.get 1 f64.store)
