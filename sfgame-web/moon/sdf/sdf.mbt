// 地形 SDF 表达式求值器（app/game/sdf.ts 的 Moonbit 同构移植，js 目标）：
// sdf(x, y) = 到地表的有符号距离，>0 空气 / <0 实体（世界坐标 y 向下）。
// 原语皆为精确 SDF（circle/box/capsule/flat），组合走 min/max/smin——
// 高度场是其中一种写法（H(x) − y），洞穴/拱门/悬挑同理可表达。
// f32 全链路：与流体 f32 存储/地形场 f32 输出一致；trig/exp 用 core 的 sinf/cosf/expf
// （纯 Moonbit fdlibm 实现，js 目标也逐位一致，不用宿主 Math.sin/cos/exp）。
// 语义基线：tests/sdf-golden.json（位级钉死）

///|
priv enum Node {
  Num(Float)
  VarX
  VarY
  Neg(Node)
  Bin(Int, Node, Node) // 0=+ 1=- 2=* 3=/
  Call(Fn, Array[Node])
}

// 直连 JS Math.min/max/abs（模块导入式 FFI）：与 TS 实现逐位同源（NaN 传播等边角语义，三者跨引擎一致）

///|
fn js_min(a : Float, b : Float) -> Float = "Math" "min"

///|
fn js_max(a : Float, b : Float) -> Float = "Math" "max"

///|
fn js_abs(a : Float) -> Float = "Math" "abs"

// 不用 Math.hypot：V8/JSC 末位实现不一致（实测 1 ulp 分歧），改用 IEEE 精确运算
// sqrt(a²+b²) 保证跨引擎逐位确定；游戏坐标量级（≤数百）无溢出/下溢顾虑

///|
fn hypot2(a : Float, b : Float) -> Float {
  (a * a + b * b).sqrt()
}

// 函数种类用枚举分派：match 中裸标识符是变量绑定而非值比较，字面量 int 表会静默全落首臂

///|
priv enum Fn {
  FAbs
  FMin
  FMax
  FClamp
  FSmoothstep // ss 为别名
  FBump
  FGauss
  FSin
  FCos
  FSqrt
  FFlat
  FCircle
  FBox
  FCapsule
  FSmin
  FSmax
}

///|
fn fn_of(name : String) -> Fn? {
  match name {
    "abs" => Some(FAbs)
    "min" => Some(FMin)
    "max" => Some(FMax)
    "clamp" => Some(FClamp)
    "smoothstep" => Some(FSmoothstep)
    "ss" => Some(FSmoothstep)
    "bump" => Some(FBump)
    "gauss" => Some(FGauss)
    "sin" => Some(FSin)
    "cos" => Some(FCos)
    "sqrt" => Some(FSqrt)
    "flat" => Some(FFlat)
    "circle" => Some(FCircle)
    "box" => Some(FBox)
    "capsule" => Some(FCapsule)
    "smin" => Some(FSmin)
    "smax" => Some(FSmax)
    _ => None
  }
}

///|
priv struct Parser {
  src : String
  mut i : Int
}

// UInt16 码元常量（输入恒为 ASCII：数字/字母/算符/空白）

///|
let c_tab : UInt16 = 9

///|
let c_lf : UInt16 = 10

///|
let c_vt : UInt16 = 11

///|
let c_ff : UInt16 = 12

///|
let c_cr : UInt16 = 13

///|
let c_space : UInt16 = 32

///|
let c_star : UInt16 = 42

///|
let c_plus : UInt16 = 43

///|
let c_comma : UInt16 = 44

///|
let c_minus : UInt16 = 45

///|
let c_dot : UInt16 = 46

///|
let c_slash : UInt16 = 47

///|
let c_0 : UInt16 = 48

///|
let c_9 : UInt16 = 57

///|
let c_E : UInt16 = 69

///|
let c_e : UInt16 = 101

///|
let c_lparen : UInt16 = 40

///|
let c_rparen : UInt16 = 41

///|
fn is_ws(c : UInt16) -> Bool {
  c == c_space || c == c_tab || c == c_lf || c == c_vt || c == c_ff || c == c_cr
}

///|
fn is_digit(c : UInt16) -> Bool {
  c >= c_0 && c <= c_9
}

///|
fn is_alpha(c : UInt16) -> Bool {
  (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c == 95 // A-Z a-z _
}

///|
fn is_alnum(c : UInt16) -> Bool {
  is_alpha(c) || is_digit(c)
}

///|
fn peek(p : Parser) -> UInt16 {
  if p.i < p.src.length() {
    p.src[p.i]
  } else {
    0
  }
}

///|
fn skip_ws(p : Parser) -> Unit {
  while p.i < p.src.length() && is_ws(p.src[p.i]) {
    p.i = p.i + 1
  }
}

///|
fn char_str(p : Parser, at : Int) -> String {
  if at < p.src.length() {
    p.src[at:at + 1].to_owned()
  } else {
    ""
  }
}

///|
fn parse(p : Parser) -> Node raise {
  let n = parse_expr(p)
  skip_ws(p)
  guard p.i >= p.src.length() else {
    fail("意外的字符 \"\{char_str(p, p.i)}\"（位置 \{p.i}）")
  }
  n
}

///|
fn parse_expr(p : Parser) -> Node raise {
  let mut a = parse_term(p)
  while true {
    skip_ws(p)
    let c = peek(p)
    if c != c_plus && c != c_minus {
      return a
    }
    p.i = p.i + 1
    let b = parse_term(p)
    a = Bin(if c == c_plus { 0 } else { 1 }, a, b)
  }
  a
}

///|
fn parse_term(p : Parser) -> Node raise {
  let mut a = parse_unary(p)
  while true {
    skip_ws(p)
    let c = peek(p)
    if c != c_star && c != c_slash {
      return a
    }
    p.i = p.i + 1
    let b = parse_unary(p)
    a = Bin(if c == c_star { 2 } else { 3 }, a, b)
  }
  a
}

///|
fn parse_unary(p : Parser) -> Node raise {
  skip_ws(p)
  let c = peek(p)
  if c == c_minus || c == c_plus {
    p.i = p.i + 1
    let a = parse_unary(p)
    return if c == c_minus { Neg(a) } else { a }
  }
  parse_primary(p)
}

///|
fn parse_primary(p : Parser) -> Node raise {
  skip_ws(p)
  let c = peek(p)
  if c == c_lparen {
    return parse_paren(p)
  }
  if is_digit(c) || c == c_dot {
    return parse_number(p)
  }
  let word = parse_word(p)
  match word {
    "x" => VarX
    "y" => VarY
    "PI" => Num(3.1415927)
    "E" => Num(2.7182817)
    _ => {
      guard word.length() > 0 else {
        fail("无法解析 \"\{char_str(p, p.i)}\"（位置 \{p.i}）")
      }
      guard fn_of(word) is Some(kind) else {
        fail("无法解析 \"\{word}\"（位置 \{p.i}）")
      }
      parse_call(p, word, kind)
    }
  }
}

///|
fn parse_paren(p : Parser) -> Node raise {
  p.i = p.i + 1
  let n = parse_expr(p)
  skip_ws(p)
  guard peek(p) == c_rparen else { fail("缺少右括号") }
  p.i = p.i + 1
  n
}

// 与 TS 正则 ^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)? 同构：
// 点号仅在后面跟数字时才吞入；指数仅在（可带符号的）数字完整时才吞入

///|
fn parse_number(p : Parser) -> Node raise {
  let start = p.i
  while is_digit(peek(p)) {
    p.i = p.i + 1
  }
  if peek(p) == c_dot && is_digit(peek_at(p, p.i + 1)) {
    p.i = p.i + 1
    while is_digit(peek(p)) {
      p.i = p.i + 1
    }
  }
  let e = peek(p)
  if e == c_e || e == c_E {
    let mut j = p.i + 1
    let s = peek_at(p, j)
    if s == c_plus || s == c_minus {
      j = j + 1
    }
    if is_digit(peek_at(p, j)) {
      p.i = j
      while is_digit(peek(p)) {
        p.i = p.i + 1
      }
    }
  }
  guard p.i > start else { fail("无效数字（位置 \{p.i}）") }
  // 词法已保证 token 形态合法，解析失败视为数字无效
  let v = Float::from_double(@string.parse_double(p.src[start:p.i]) catch {
    _ => fail("无效数字（位置 \{start}）")
  })
  Num(v)
}

///|
fn peek_at(p : Parser, at : Int) -> UInt16 {
  if at < p.src.length() {
    p.src[at]
  } else {
    0
  }
}

///|
fn parse_word(p : Parser) -> String {
  skip_ws(p)
  let start = p.i
  if is_alpha(peek(p)) {
    p.i = p.i + 1
    while is_alnum(peek(p)) {
      p.i = p.i + 1
    }
  }
  p.src[start:p.i].to_owned()
}

///|
fn parse_call(p : Parser, word : String, kind : Fn) -> Node raise {
  skip_ws(p)
  guard peek(p) == c_lparen else { fail("函数 \{word} 需要括号") }
  p.i = p.i + 1
  let args : Array[Node] = []
  if peek(p) != c_rparen {
    while true {
      args.push(parse_expr(p))
      skip_ws(p)
      if peek(p) != c_comma {
        break
      }
      p.i = p.i + 1
    }
  }
  guard peek(p) == c_rparen else { fail("函数 \{word} 缺少右括号") }
  p.i = p.i + 1
  Call(kind, args)
}

///|
fn clamp01(v : Float) -> Float {
  if v < 0.0 {
    0.0
  } else if v > 1.0 {
    1.0
  } else {
    v
  }
}

///|
fn smoothstep_curve(t : Float) -> Float {
  let c = clamp01(t)
  c * c * (3.0 - 2.0 * c)
}

///|
fn expect_args(args : FixedArray[Float], n : Int, name : String) -> Unit raise {
  guard args.length() == n else { fail("\{name} 需 \{n} 参") }
}

// 1 参 = smoothstep(t)；3 参 = GLSL smoothstep(e0,e1,x)（GLSL 规定 e0≥e1 未定义，这里拒绝）

///|
fn smoothstep_fn(args : FixedArray[Float]) -> Float raise {
  match args.length() {
    1 => smoothstep_curve(args[0])
    3 => {
      let e0 = args[0]
      let e1 = args[1]
      let x = args[2]
      guard e0 < e1 else { fail("smoothstep(e0,e1,x) 要求 e0 < e1") }
      smoothstep_curve((x - e0) / (e1 - e0))
    }
    _ =>
      fail("smoothstep 需 1 参 smoothstep(t) 或 3 参 smoothstep(e0,e1,x)")
  }
}

// 签名统一 (实参 scratch, x, y)：剖面类用 x，SDF 原语用 (x, y)

///|
fn eval_fn(
  kind : Fn,
  args : FixedArray[Float],
  x : Float,
  y : Float,
) -> Float raise {
  match kind {
    FAbs => js_abs(args[0])
    FMin => js_min(args[0], args[1])
    FMax => js_max(args[0], args[1])
    FClamp => js_min(args[2], js_max(args[1], args[0]))
    FSmoothstep => smoothstep_fn(args)
    // 单峰山丘：跨 [c-w, c+w] 峰高 h，两端斜率 0，与平原 C1 相接
    FBump => {
      expect_args(args, 3, "bump(c,w,h) 中心/半宽/峰高")
      let c = args[0]
      let w = args[1]
      let h = args[2]
      guard w > 0.0 else { fail("bump 半宽 w 必须 > 0") }
      h *
      smoothstep_curve((x - (c - w)) / w) *
      smoothstep_curve((c + w - x) / w)
    }
    // 高斯圆丘：C∞ 圆顶，永不归零（3w 处残量 ~1e-4，视觉无感）
    FGauss => {
      expect_args(args, 3, "gauss(c,w,h) 中心/宽度/峰高")
      let c = args[0]
      let w = args[1]
      let h = args[2]
      guard w > 0.0 else { fail("gauss 宽度 w 必须 > 0") }
      let t = (x - c) / w
      h * @math.expf(-t * t)
    }
    FSin => @math.sinf(args[0])
    FCos => @math.cosf(args[0])
    FSqrt => args[0].sqrt()
    // 半空间：y0 以下（y 向下）为实体，平原/地基
    FFlat => {
      expect_args(args, 1, "flat(y0) 地表高度")
      args[0] - y
    }
    FCircle => {
      expect_args(args, 3, "circle(cx,cy,r)")
      guard args[2] > 0.0 else { fail("circle 半径必须 > 0") }
      hypot2(x - args[0], y - args[1]) - args[2]
    }
    // 圆角盒（r 可省 = 直角）：hw/hh 为半宽/半高
    FBox => {
      guard args.length() == 4 || args.length() == 5 else {
        fail("box(cx,cy,hw,hh[,r]) 需 4-5 参")
      }
      let cx = args[0]
      let cy = args[1]
      let hw = args[2]
      let hh = args[3]
      let r : Float = if args.length() == 5 { args[4] } else { 0.0 }
      guard hw > 0.0 && hh > 0.0 else { fail("box 半宽/半高必须 > 0") }
      let qx = js_abs(x - cx) - (hw - r)
      let qy = js_abs(y - cy) - (hh - r)
      hypot2(js_max(qx, 0.0), js_max(qy, 0.0)) + js_min(js_max(qx, qy), 0.0) - r
    }
    // 胶囊（线段加半径）：山脊/斜坡的圆润替身
    FCapsule => {
      expect_args(args, 5, "capsule(x0,y0,x1,y1,r)")
      guard args[4] > 0.0 else { fail("capsule 半径必须 > 0") }
      let px = x - args[0]
      let py = y - args[1]
      let bx = args[2] - args[0]
      let by = args[3] - args[1]
      let denom = bx * bx + by * by
      let t : Float = if denom > 0.0 {
        clamp01((px * bx + py * by) / denom)
      } else {
        0.0
      }
      hypot2(px - bx * t, py - by * t) - args[4]
    }
    // 光滑并/交（多项式型，k = 过渡带宽）：min/max 是 k→0 的硬极限；挖洞 = smax(a, −b, k)
    FSmin => {
      expect_args(args, 3, "smin(a,b,k)")
      guard args[2] > 0.0 else { fail("smin 带宽 k 必须 > 0") }
      let a = args[0]
      let b = args[1]
      let k = args[2]
      let h = clamp01(0.5 + 0.5 * (b - a) / k)
      b + (a - b) * h - k * h * (1.0 - h)
    }
    FSmax => {
      expect_args(args, 3, "smax(a,b,k)")
      guard args[2] > 0.0 else { fail("smax 带宽 k 必须 > 0") }
      let a = args[0]
      let b = args[1]
      let k = args[2]
      let h = clamp01(0.5 - 0.5 * (b - a) / k)
      b + (a - b) * h + k * h * (1.0 - h)
    }
  }
}

// 构造期实际不失败（错误在解析期或闭包求值期）：op 由解析器产出恒为 0-3，
// else 分支即除法，与 TS 版不可达的未知运算符分支同构；raise 仅因递归传播

///|
fn compile_node(n : Node) -> ((Float, Float) -> Float raise) raise {
  match n {
    Num(v) => (_, _) => v
    VarX => (x, _) => x
    VarY => (_, y) => y
    Neg(a) => {
      let ca = compile_node(a)
      (x, y) => -ca(x, y)
    }
    Bin(op, a, b) => {
      let ca = compile_node(a)
      let cb = compile_node(b)
      if op == 0 {
        (x, y) => ca(x, y) + cb(x, y)
      } else if op == 1 {
        (x, y) => ca(x, y) - cb(x, y)
      } else if op == 2 {
        (x, y) => ca(x, y) * cb(x, y)
      } else {
        (x, y) => ca(x, y) / cb(x, y)
      }
    }
    Call(kind, args) => {
      let compiled = args.map(compile_node)
      // scratch 每 call 节点独享复用，嵌套调用各持各的，无冲突（热路径零分配）
      let scratch : FixedArray[Float] = FixedArray::make(
        compiled.length(),
        0.0,
      )
      (x, y) => {
        for i in 0..<compiled.length() {
          scratch[i] = compiled[i](x, y)
        }
        eval_fn(kind, scratch, x, y)
      }
    }
  }
}

// 语法错误在编译期抛出；实参语义错误（负半径等）在求值期抛出——与 TS 版一致。
// 返回 raise 闭包：JS 侧每次调用得到 Result 包装（Ok 值 / Err 消息），门面负责解包

///|
#export_name("compile")
pub fn compile(src : String) -> ((Float, Float) -> Float raise) raise {
  compile_node(parse(Parser::{ src, i: 0 }))
}

// 整场烘焙：表达式在 nx×ny 格心一次求值，宿主一次跨界取代 nx×ny 次调用。
// 坐标与 terrain.ts 的 bakeTerrain 同构：wy=(j−origin+0.5)·cell、wx=(i−origin+0.5)·cell

///|
#export_name("bake")
pub fn bake(
  src : String,
  nx : Int,
  ny : Int,
  origin : Int,
  cell : Float,
) -> Array[Float] raise {
  let f = compile_node(parse(Parser::{ src, i: 0 }))
  let n = nx * ny
  let out : Array[Float] = Array::make(n, 0.0)
  let ox = Float::from_int(origin)
  for j in 0..<ny {
    let wy = (Float::from_int(j) - ox + 0.5) * cell
    let row = j * nx
    for i in 0..<nx {
      out[i + row] = f((Float::from_int(i) - ox + 0.5) * cell, wy)
    }
  }
  out
}
