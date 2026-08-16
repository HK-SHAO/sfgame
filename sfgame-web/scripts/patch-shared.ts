// 共享内存注入：moonc 产出的 wasm 是普通（非 shared）Memory；SAB 跨线程零拷贝要求
// Memory 带 shared 位。二进制层面只改一处：
//   memory 段 limits flags 0x01(has_max) → 0x03(has_max|shared)——threads 提案官方编码，
//   布局漂移即抛错，构建响亮失败。不追加 target_features 段：三大引擎（V8/JSC/SM）源码均不消费，
//   消费方只有链接器（wasm-ld/binaryen），而本产物是终产物不经链接；该段的规范编码是
//   count 前缀 + 特性名字符串（tool-conventions），曾误写数字 ID 会令 wasm-opt 严格解析报错，故删。
// 已实证：patch 后 node 实例化成功、memory.buffer instanceof SharedArrayBuffer === true、tracer golden 逐位一致。
// 纯字节操作不经 wasm 重编译：moon/ 与引擎源码零改动，golden 契约不破。
import { readFileSync, writeFileSync } from 'node:fs'

// 全量遍历段：返回 memory 段 flags 的字节偏移与现值（找不到则 -1）
function scan(buf: Uint8Array): { memFlagsOff: number; memFlags: number } {
  if (buf[0] !== 0x00 || buf[1] !== 0x61 || buf[2] !== 0x73 || buf[3] !== 0x6d) {
    throw new Error('shared 注入：非 wasm 魔数')
  }
  if (buf[4] !== 0x01 || buf[5] !== 0x00 || buf[6] !== 0x00 || buf[7] !== 0x00) {
    throw new Error('shared 注入：非 wasm 1.0 版本')
  }
  let off = 8
  let memFlagsOff = -1
  let memFlags = -1
  while (off < buf.length) {
    let id = 0
    let shift = 0
    let i = off
    while (true) {
      const b = buf[i++]
      id |= (b & 0x7f) << shift
      if ((b & 0x80) === 0) break
      shift += 7
    }
    let size = 0
    shift = 0
    while (true) {
      const b = buf[i++]
      size |= (b & 0x7f) << shift
      if ((b & 0x80) === 0) break
      shift += 7
    }
    const start = i
    if (id === 5) {
      // memory 段：count(1) + limits(flags [+min [+max]])
      if (buf[start] !== 1) throw new Error('shared 注入：memory 段 count ≠ 1')
      let fl = 0
      shift = 0
      let fi = start + 1
      while (true) {
        const b = buf[fi++]
        fl |= (b & 0x7f) << shift
        if ((b & 0x80) === 0) break
        shift += 7
      }
      memFlagsOff = start + 1
      memFlags = fl
    }
    off = start + size
  }
  if (off !== buf.length) throw new Error('shared 注入：段遍历未对齐文件尾')
  return { memFlagsOff, memFlags }
}

// 对磁盘上的 wasm 文件执行共享注入（幂等：已带 shared 位则零改动）
export function patchSharedWasm(path: string): void {
  const buf = new Uint8Array(readFileSync(path))
  const { memFlagsOff, memFlags } = scan(buf)
  if (memFlagsOff < 0) throw new Error('shared 注入：未找到 memory 段')
  // moonc 产物恒 has_max（min=max 静态容量钉死）；shared 位置入前必须为 0x01，防布局漂移静默错位
  if (memFlags !== 1 && memFlags !== 3) {
    throw new Error(`shared 注入：memory flags=${memFlags}（期望 0x01），wasm 布局漂移，构建中止`)
  }
  if (memFlags === 1) {
    const patched = new Uint8Array(buf)
    patched[memFlagsOff] = 3
    writeFileSync(path, patched)
  }
  verifySharedWasm(readFileSync(path))
}

// 自检：patch 后重新解析，memory flags 必须含 shared 位
export function verifySharedWasm(raw: Uint8Array): void {
  const { memFlags } = scan(new Uint8Array(raw))
  if ((memFlags & 0x02) === 0) throw new Error('shared 注入自检失败：memory flags 缺 shared 位')
}
