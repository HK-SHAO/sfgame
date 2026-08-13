// 地形 SDF 表达式求值器（零依赖纯 TS）：sdf(x, y) = 到地表的有符号距离，>0 空气 / <0 实体。
// 世界坐标 y 向下。原语皆为精确 SDF（circle/box/capsule/flat），组合走 min/max/smin——
// 高度场是其中一种写法（H(x) − y），洞穴/拱门/悬挑同理可表达。
// 跨平台位级一致（烘焙场喂 wasm 流体掩码，逐位确定）：
//  - 不用 Math.hypot（V8/JSC 末位实现不一致，实测 1 ulp 分歧）→ sqrt(a²+b²)，IEEE 规定位
//  - 四则/min/max/abs/sqrt 均为 IEEE 规定位，全引擎一致
//  - sin/cos/exp 走原生 Math（跨引擎 ≤1 ulp）：仅 trig 关卡用到（现无），且烘焙场存 f32，
//    1 ulp f64 差被 f32 舍入抹平，不影响掩码/物理；语义漂移由 sdf-golden 近似容差守护

type Node =
  | { k: 'num'; v: number }
  | { k: 'var'; name: 'x' | 'y' }
  | { k: 'neg'; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; fn: string; args: Node[] }

export class SdfError extends Error {}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
// IEEE 精确距离（等价 Math.hypot 但跨引擎位级确定）
const hypot2 = (a: number, b: number) => Math.sqrt(a * a + b * b)

const smoothstepCurve = (t: number) => {
  const c = clamp01(t)
  return c * c * (3 - 2 * c)
}

const expectArgs = (args: unknown[], n: number, name: string) => {
  if (args.length !== n) throw new SdfError(`${name} 需 ${n} 参`)
}

// 1 参 = smoothstep(t)；3 参 = GLSL smoothstep(e0,e1,x)（GLSL 规定 e0≥e1 未定义，这里拒绝）；ss 为常用别名
const smoothstepFn = (args: number[]) => {
  if (args.length === 1) return smoothstepCurve(args[0])
  if (args.length === 3) {
    const [e0, e1, x] = args
    if (e0 >= e1) throw new SdfError('smoothstep(e0,e1,x) 要求 e0 < e1')
    return smoothstepCurve((x - e0) / (e1 - e0))
  }
  throw new SdfError('smoothstep 需 1 参 smoothstep(t) 或 3 参 smoothstep(e0,e1,x)')
}

const FUNCS: Record<string, (args: number[], x: number, y: number) => number> = {
  // 签名统一 (实参, x, y)：剖面类用 x，SDF 原语用 (x, y)
  abs: ([v]) => Math.abs(v),
  min: ([a, b]) => Math.min(a, b),
  max: ([a, b]) => Math.max(a, b),
  clamp: ([v, lo, hi]) => Math.min(hi, Math.max(lo, v)),
  smoothstep: smoothstepFn,
  ss: smoothstepFn,
  // 高度场剖面配料（以 x 为自变量，加进 H(x) − y 里）
  // 单峰山丘：跨 [c-w, c+w] 峰高 h，两端斜率 0，与平原 C1 相接
  bump: (args, x) => {
    const [c, w, h] = args
    expectArgs(args, 3, 'bump(c,w,h) 中心/半宽/峰高')
    if (w <= 0) throw new SdfError('bump 半宽 w 必须 > 0')
    return h * smoothstepCurve((x - (c - w)) / w) * smoothstepCurve((c + w - x) / w)
  },
  // 高斯圆丘：C∞ 圆顶，永不归零（3w 处残量 ~1e-4，视觉无感）
  gauss: (args, x) => {
    const [c, w, h] = args
    expectArgs(args, 3, 'gauss(c,w,h) 中心/宽度/峰高')
    if (w <= 0) throw new SdfError('gauss 宽度 w 必须 > 0')
    const t = (x - c) / w
    return h * Math.exp(-t * t)
  },
  sin: ([v]) => Math.sin(v),
  cos: ([v]) => Math.cos(v),
  sqrt: ([v]) => Math.sqrt(v),
  // —— SDF 原语（精确距离）——
  // 半空间：y0 以下（y 向下）为实体，平原/地基
  flat: (args, _x, y) => {
    expectArgs(args, 1, 'flat(y0) 地表高度')
    return args[0] - y
  },
  circle: (args, x, y) => {
    expectArgs(args, 3, 'circle(cx,cy,r)')
    if (args[2] <= 0) throw new SdfError('circle 半径必须 > 0')
    return hypot2(x - args[0], y - args[1]) - args[2]
  },
  // 圆角盒（r 可省 = 直角）：hw/hh 为半宽/半高
  box: (args, x, y) => {
    if (args.length !== 4 && args.length !== 5) throw new SdfError('box(cx,cy,hw,hh[,r]) 需 4-5 参')
    const [cx, cy, hw, hh] = args
    const r = args.length === 5 ? args[4] : 0
    if (hw <= 0 || hh <= 0) throw new SdfError('box 半宽/半高必须 > 0')
    const qx = Math.abs(x - cx) - (hw - r)
    const qy = Math.abs(y - cy) - (hh - r)
    return hypot2(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
  },
  // 胶囊（线段加半径）：山脊/斜坡的圆润替身
  capsule: (args, x, y) => {
    expectArgs(args, 5, 'capsule(x0,y0,x1,y1,r)')
    if (args[4] <= 0) throw new SdfError('capsule 半径必须 > 0')
    const px = x - args[0]
    const py = y - args[1]
    const bx = args[2] - args[0]
    const by = args[3] - args[1]
    const denom = bx * bx + by * by
    const t = denom > 0 ? clamp01((px * bx + py * by) / denom) : 0
    return hypot2(px - bx * t, py - by * t) - args[4]
  },
  // 光滑并/交（多项式型，k = 过渡带宽）：min/max 是 k→0 的硬极限；挖洞 = smax(a, −b, k)
  smin: (args) => {
    expectArgs(args, 3, 'smin(a,b,k)')
    if (args[2] <= 0) throw new SdfError('smin 带宽 k 必须 > 0')
    const [a, b, k] = args
    const h = clamp01(0.5 + (0.5 * (b - a)) / k)
    return b + (a - b) * h - k * h * (1 - h)
  },
  smax: (args) => {
    expectArgs(args, 3, 'smax(a,b,k)')
    if (args[2] <= 0) throw new SdfError('smax 带宽 k 必须 > 0')
    const [a, b, k] = args
    const h = clamp01(0.5 - (0.5 * (b - a)) / k)
    return b + (a - b) * h + k * h * (1 - h)
  },
}

class Parser {
  private src: string
  private i = 0

  constructor(src: string) {
    this.src = src
  }

  parse(): Node {
    const n = this.expr()
    this.skipWs()
    if (this.i < this.src.length) throw new SdfError(`意外的字符 "${this.src[this.i]}"（位置 ${this.i}）`)
    return n
  }

  private expr(): Node {
    let a = this.term()
    for (;;) {
      const op = this.peekOp(['+', '-'])
      if (!op) return a
      this.i++
      a = { k: 'bin', op, a, b: this.term() }
    }
  }

  private term(): Node {
    let a = this.factor()
    for (;;) {
      const op = this.peekOp(['*', '/'])
      if (!op) return a
      this.i++
      a = { k: 'bin', op, a, b: this.factor() }
    }
  }

  private factor(): Node {
    return this.unary()
  }

  private unary(): Node {
    this.skipWs()
    const c = this.src[this.i]
    if (c === '-' || c === '+') {
      this.i++
      const a = this.unary()
      return c === '-' ? { k: 'neg', a } : a
    }
    return this.primary()
  }

  private primary(): Node {
    this.skipWs()
    const c = this.src[this.i]
    if (c === '(') return this.paren()
    if (/[0-9.]/.test(c ?? '')) return this.number()
    const word = this.word()
    if (word === 'x') return { k: 'var', name: 'x' }
    if (word === 'y') return { k: 'var', name: 'y' }
    if (word === 'PI') return { k: 'num', v: Math.PI }
    if (word === 'E') return { k: 'num', v: Math.E }
    if (word && FUNCS[word]) return this.call(word)
    throw new SdfError(`无法解析 "${word || (c ?? '')}"（位置 ${this.i}）`)
  }

  private paren(): Node {
    this.i++
    const n = this.expr()
    this.skipWs()
    if (this.src[this.i] !== ')') throw new SdfError('缺少右括号')
    this.i++
    return n
  }

  private call(word: string): Node {
    this.skipWs()
    if (this.src[this.i] !== '(') throw new SdfError(`函数 ${word} 需要括号`)
    this.i++
    const args: Node[] = []
    if (this.src[this.i] !== ')') {
      for (;;) {
        args.push(this.expr())
        this.skipWs()
        if (this.src[this.i] === ',') {
          this.i++
          continue
        }
        break
      }
    }
    if (this.src[this.i] !== ')') throw new SdfError(`函数 ${word} 缺少右括号`)
    this.i++
    return { k: 'call', fn: word, args }
  }

  private number(): Node {
    const m = /^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?/.exec(this.src.slice(this.i))
    if (!m) throw new SdfError(`无效数字（位置 ${this.i}）`)
    this.i += m[0].length
    return { k: 'num', v: Number(m[0]) }
  }

  private word(): string {
    this.skipWs()
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.src.slice(this.i))
    if (!m) return ''
    this.i += m[0].length
    return m[0]
  }

  private peekOp(ops: string[]): string | null {
    this.skipWs()
    const c = this.src[this.i]
    return ops.includes(c) ? c : null
  }

  private skipWs() {
    while (/\s/.test(this.src[this.i] ?? '')) this.i++
  }
}

type Compiled = (x: number, y: number) => number

// scratch 每 call 节点独享复用，嵌套调用各持各的，无冲突
function compileNode(n: Node): Compiled {
  switch (n.k) {
    case 'num': {
      const v = n.v
      return () => v
    }
    case 'var':
      return n.name === 'x' ? (x) => x : (_x, y) => y
    case 'neg': {
      const a = compileNode(n.a)
      return (x, y) => -a(x, y)
    }
    case 'bin': {
      const a = compileNode(n.a)
      const b = compileNode(n.b)
      switch (n.op) {
        case '+':
          return (x, y) => a(x, y) + b(x, y)
        case '-':
          return (x, y) => a(x, y) - b(x, y)
        case '*':
          return (x, y) => a(x, y) * b(x, y)
        case '/':
          return (x, y) => a(x, y) / b(x, y)
      }
      throw new SdfError(`未知运算符 ${n.op}`)
    }
    case 'call': {
      const f = FUNCS[n.fn]
      if (!f) throw new SdfError(`未知函数 ${n.fn}`)
      const args = n.args.map(compileNode)
      const scratch = new Array<number>(args.length)
      return (x, y) => {
        for (let i = 0; i < args.length; i++) scratch[i] = args[i](x, y)
        return f(scratch, x, y)
      }
    }
  }
}

// 语法错误在关卡加载期抛出，而非模拟中
export function compileSdf(src: string): (x: number, y: number) => number {
  return compileNode(new Parser(src).parse())
}

// 整场烘焙：表达式在 nx×ny 格心一次求值返回 f32 场（Float32Array 存储即舍入）。
// 坐标与 terrain.ts 的 bakeTerrain 同构：wy=(j−origin+0.5)·cell、wx=(i−origin+0.5)·cell；
// mask（d≤0）由 terrain.ts 在存储后的场本地计算，场/掩码同源一致
export function bakeSdf(src: string, nx: number, ny: number, origin: number, cell: number): Float32Array {
  const f = compileSdf(src)
  const out = new Float32Array(nx * ny)
  for (let j = 0; j < ny; j++) {
    const wy = (j - origin + 0.5) * cell
    const row = j * nx
    for (let i = 0; i < nx; i++) {
      out[i + row] = f((i - origin + 0.5) * cell, wy)
    }
  }
  return out
}
