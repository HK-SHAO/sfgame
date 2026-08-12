// 地形 SDF 表达式求值门面：数值实现在 moon/sdf（Moonbit 编译 js 目标产物 sdfjs/sdf.js），
// sdf(x, y) = 到地表的有符号距离，>0 空气 / <0 实体。原语皆为精确 SDF，组合走 min/max/smin——
// 高度场是其中一种写法（H(x) − y），洞穴/拱门/悬挑同理可表达。
// 本文件保持 SdfError 类与 compileSdf 签名不变；moonbit 错误消息带 SourceLoc 前缀
// （…FAILED: 正文），抽取正文后包装为 SdfError 抛出
import { compile as mbtCompile } from './sdfjs/sdf.js'

export class SdfError extends Error {}

type MbResult = { $tag: number; _0: unknown }

function extractMsg(errWrapper: unknown): string {
  const s = (errWrapper as { _0?: unknown })?._0
  if (typeof s === 'string') {
    const m = /FAILED: ([\s\S]*)$/.exec(s)
    return m ? m[1] : s
  }
  return '未知 SDF 错误'
}

// 语法错误在编译期抛出，实参语义错误（负半径等）在求值期抛出——与迁移前行为一致
export function compileSdf(src: string): (x: number, y: number) => number {
  const compiled = mbtCompile(src) as MbResult
  if (!compiled || compiled.$tag !== 1) {
    throw new SdfError(extractMsg(compiled?._0))
  }
  const f = compiled._0 as (x: number, y: number) => MbResult
  return (x, y) => {
    const r = f(x, y)
    if (!r || r.$tag !== 1) {
      throw new SdfError(extractMsg(r?._0))
    }
    return r._0 as number
  }
}
