/**
 * 迷你数学表达式求值器（零依赖，关卡地形 expr 的运行时）。
 * 语法：数字 / x / PI / E；+ - * / % ^（右结合）；一元正负；括号；
 * 函数：abs min max clamp step smoothstep sin cos exp sqrt pow。
 * 刻意不做变量赋值/条件/字符串——地形只是 y = f(x)，克制即足够。
 * 表达式是"可移植的公式"：同一串文本可被任意数学工具直接解释。
 */

type Node =
  | { k: 'num'; v: number }
  | { k: 'x' }
  | { k: 'neg'; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; fn: string; args: Node[] }

const FUNCS: Record<string, (args: number[]) => number> = {
  abs: ([v]) => Math.abs(v),
  min: ([a, b]) => Math.min(a, b),
  max: ([a, b]) => Math.max(a, b),
  clamp: ([v, lo, hi]) => Math.min(hi, Math.max(lo, v)),
  step: ([x, edge]) => (x >= edge ? 1 : 0),
  smoothstep: ([t]) => {
    const c = Math.min(1, Math.max(0, t))
    return c * c * (3 - 2 * c)
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
    if (c === '(') {
      this.i++
      const n = this.expr()
      this.skipWs()
      if (this.src[this.i] !== ')') throw new ExprError('缺少右括号')
      this.i++
      return n
    }
    if (/[0-9.]/.test(c ?? '')) return this.number()
    const word = this.word()
    if (word === 'x') return { k: 'x' }
    if (word === 'PI') return { k: 'num', v: Math.PI }
    if (word === 'E') return { k: 'num', v: Math.E }
    if (word && FUNCS[word]) {
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
    throw new ExprError(`无法解析 "${word || c}"（位置 ${this.i}）`)
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
      return f(n.args.map((a) => evalNode(a, x)))
    }
  }
}

/** 编译表达式为 height(x) 函数；语法错误在此抛出（关卡加载期，而非模拟中）。 */
export function compileExpr(src: string): (x: number) => number {
  const tree = new Parser(src).parse()
  return (x) => evalNode(tree, x)
}
