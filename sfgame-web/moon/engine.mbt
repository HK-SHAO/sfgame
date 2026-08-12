// 引擎级握手：canary 缓冲供宿主双向校验"导出地址 = FixedArray 数据区"寻址约定。
// 全部零拷贝 view（流体场/顶点缓冲/粒子状态）都建立在该约定上，故引导期必测。

///|
let canary : FixedArray[Int] = FixedArray::make(4, 0)

///|
#export_name("canary_buf")
pub fn canary_buf() -> Int {
  addr_of_i32(canary)
}

///|
#export_name("canary_len")
pub fn canary_len() -> Int {
  4
}

///|
#export_name("canary_set")
pub fn canary_set(i : Int, v : Int) -> Unit {
  canary[i] = v
}

///|
#export_name("canary_get")
pub fn canary_get(i : Int) -> Int {
  canary[i]
}
