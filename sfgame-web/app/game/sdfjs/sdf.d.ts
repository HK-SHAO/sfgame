// moon/sdf 包 js 目标产物的类型声明（sdf.js 由 build:wasm 生成、不入库；
// 源码 sfgame-web/moon/sdf/sdf.mbt）。导出边界约定：raise 函数经 JS 边界返回
// Result 对象——$tag=1 为 Ok（_0 = 值），$tag=0 为 Err（_0._0 = 带 SourceLoc 前缀的消息字符串）
export function compile(src: string): { $tag: number; _0: unknown }
