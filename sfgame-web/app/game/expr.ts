// 迷你表达式求值器（零依赖）：刻意不做变量赋值/条件/字符串——地形只是 y=f(x)，且表达式可移植到任意数学工具

type Node =
  | { k: 'num'; v: number }
  | { k: 'x' }
  | { k: 'neg'; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; fn: string; args: Node[] }

const smoothstepCurve = (t: number) => {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}

// 参数个数守卫（bump/gauss/smoothstep 等固定 arity 函数共用）
const expectArgs = (args: unknown[], n: number, name: string) => {
  if (args.length !== n) throw new ExprError(`${name} 需 ${n} 参`)
}

// 1 参 = smoothstep(t)；3 参 = GLSL smoothstep(e0,e1,x)（GLSL 规定 e0≥e1 未定义，这里拒绝）；ss 为常用别名
const smoothstepFn = (args: number[]) => {
  if (args.length === 1) return smoothstepCurve(args[0])
  if (args.length === 3) {
    const [e0, e1, x] = args
    if (e0 >= e1) throw new ExprError('smoothstep(e0,e1,x) 要求 e0 < e1')
    return smoothstepCurve((x - e0) / (e1 - e0))
  }
  throw new ExprError('smoothstep 需 1 参 smoothstep(t) 或 3 参 smoothstep(e0,e1,x)')
}

const FUNCS: Record<string, (args: number[], x: number) => number> = {
  abs: ([v]) => Math.abs(v),
  min: ([a, b]) => Math.min(a, b),
  max: ([a, b]) => Math.max(a, b),
  clamp: ([v, lo, hi]) => Math.min(hi, Math.max(lo, v)),
  step: ([t, edge]) => (t >= edge ? 1 : 0),
  smoothstep: smoothstepFn,
  ss: smoothstepFn,
  // 单峰山丘：跨 [c-w, c+w] 峰高 h，两端斜率 0，与平原 C1 相接
  bump: (args, x) => {
    const [c, w, h] = args
    expectArgs(args, 3, 'bump(c,w,h) 中心/半宽/峰高')
    if (w <= 0) throw new ExprError('bump 半宽 w 必须 > 0')
    return h * smoothstepCurve((x - (c - w)) / w) * smoothstepCurve((c + w - x) / w)
  },
  // 高斯圆丘：C∞ 圆顶，永不归零（3w 处残量 ~1e-4，视觉无感）
  gauss: (args, x) => {
    const [c, w, h] = args
    expectArgs(args, 3, 'gauss(c,w,h) 中心/宽度/峰高')
    if (w <= 0) throw new ExprError('gauss 宽度 w 必须 > 0')
    const t = (x - c) / w
    return h * Math.exp(-t * t)
  },
  sin: ([v]) => Math.sin(v),
  cos: ([v]) => Math.cos(v),
  exp: ([v]) => Math.exp(v),
  sqrt: ([v]) => Math.sqrt(v),
  pow: ([a, b]) => Math.pow(a, b),
}

export class ExprError extends Error {}

class Parser {
  private src: string
  private i = 0

  constructor(src: string) {
    this.src = src
  }

  parse(): Node {
    const n = this.expr()
    this.skipWs()
    if (this.i < this.src.length) throw new ExprError(`意外的字符 "${this.src[this.i]}"（位置 ${this.i}）`)
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
      const op = this.peekOp(['*', '/', '%'])
      if (!op) return a
      this.i++
      a = { k: 'bin', op, a, b: this.factor() }
    }
  }

  private factor(): Node {
    const a = this.unary()
    if (this.peekOp(['^'])) {
      this.i++
      return { k: 'bin', op: '^', a, b: this.factor() }
    }
    return a
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
    if (word === 'x') return { k: 'x' }
    if (word === 'PI') return { k: 'num', v: Math.PI }
    if (word === 'E') return { k: 'num', v: Math.E }
    if (word && FUNCS[word]) return this.call(word)
    throw new ExprError(`无法解析 "${word || (c ?? '')}"（位置 ${this.i}）`)
  }

  private paren(): Node {
    this.i++
    const n = this.expr()
    this.skipWs()
    if (this.src[this.i] !== ')') throw new ExprError('缺少右括号')
    this.i++
    return n
  }

  private call(word: string): Node {
    this.skipWs()
    if (this.src[this.i] !== '(') throw new ExprError(`函数 ${word} 需要括号`)
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
    if (this.src[this.i] !== ')') throw new ExprError(`函数 ${word} 缺少右括号`)
    this.i++
    return { k: 'call', fn: word, args }
  }

  private number(): Node {
    const m = /^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?/.exec(this.src.slice(this.i))
    if (!m) throw new ExprError(`无效数字（位置 ${this.i}）`)
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

function evalNode(n: Node, x: number): number {
  switch (n.k) {
    case 'num':
      return n.v
    case 'x':
      return x
    case 'neg':
      return -evalNode(n.a, x)
    case 'bin': {
      const a = evalNode(n.a, x)
      const b = evalNode(n.b, x)
      switch (n.op) {
        case '+':
          return a + b
        case '-':
          return a - b
        case '*':
          return a * b
        case '/':
          return a / b
        case '%':
          return a % b
        case '^':
          return Math.pow(a, b)
      }
      throw new ExprError(`未知运算符 ${n.op}`)
    }
    case 'call': {
      const f = FUNCS[n.fn]
      if (!f) throw new ExprError(`未知函数 ${n.fn}`)
      return f(n.args.map((a) => evalNode(a, x)), x)
    }
  }
}

// 语法错误在关卡加载期抛出，而非模拟中
export function compileExpr(src: string): (x: number) => number {
  const tree = new Parser(src).parse()
  return (x) => evalNode(tree, x)
}
