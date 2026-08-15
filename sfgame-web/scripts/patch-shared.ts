// 共享内存注入：moonc 产出的 wasm 是普通（非 shared）Memory；SAB 跨线程零拷贝要求
// Memory 带 shared 位。二进制层面改动两处：
//   1) memory 段 limits flags 0x01(has_max) → 0x03(has_max|shared)——布局漂移即抛错，构建响亮失败
//   2) 段尾追加 custom 段 target_features（'+' threads bulk-memory simd，WebAssembly tool-conventions 规范）
// 已实证：patch 后 node 实例化成功、memory.buffer instanceof SharedArrayBuffer === true、tracer golden 逐位一致。
// 纯字节操作不经 wasm 重编译：moon/ 与引擎源码零改动，golden 契约不破。
import { readFileSync, writeFileSync } from 'node:fs'

// target_features 段内容：'+'=0x2b，随后三个 feature id（threads=0x01 bulk-memory=0x02 simd=0x04）
const TARGET_FEATURES = new Uint8Array([0x2b, 0x01, 0x02, 0x04])
const FEATURES_NAME = 'target_features'

// 全量遍历段（自检与主流程共用）：返回 memory 段 flags 的字节偏移（或 -1）与 custom 段名集合
function scan(buf: Uint8Array): { memFlagsOff: number; memFlags: number; customs: Set<string> } {
  const customs = new Set<string>()
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
    } else if (id === 0) {
      // custom 段：name_len + name
      const nl = buf[start]
      customs.add(String.fromCharCode(...buf.subarray(start + 1, start + 1 + nl)))
    }
    off = start + size
  }
  if (off !== buf.length) throw new Error('shared 注入：段遍历未对齐文件尾')
  return { memFlagsOff, memFlags, customs }
}

// 对磁盘上的 wasm 文件执行共享注入（幂等：已带 shared 位则只补 target_features）
export function patchSharedWasm(path: string): void {
  const buf = new Uint8Array(readFileSync(path))
  const { memFlagsOff, memFlags, customs } = scan(buf)
  if (memFlagsOff < 0) throw new Error('shared 注入：未找到 memory 段')
  // moonc 产物恒 has_max（min=max 静态容量钉死）；shared 位置入前必须为 0x01，防布局漂移静默错位
  if (memFlags !== 1 && memFlags !== 3) {
    throw new Error(`shared 注入：memory flags=${memFlags}（期望 0x01），wasm 布局漂移，构建中止`)
  }
  const patched = new Uint8Array(buf)
  if (memFlags === 1) patched[memFlagsOff] = 3
  if (!customs.has(FEATURES_NAME)) {
    const name = new TextEncoder().encode(FEATURES_NAME)
    // 段 = id(0) + size + name_len + name + content；size 恒 < 128 单字节 LEB
    const size = 1 + name.length + TARGET_FEATURES.length
    if (size >= 0x80) throw new Error('shared 注入：target_features 段超出单字节 size')
    const out = new Uint8Array(patched.length + 1 + 1 + size)
    out.set(patched, 0)
    out[patched.length] = 0
    out[patched.length + 1] = size
    out[patched.length + 2] = name.length
    out.set(name, patched.length + 3)
    out.set(TARGET_FEATURES, patched.length + 3 + name.length)
    writeFileSync(path, out)
    verifySharedWasm(readFileSync(path))
  } else {
    writeFileSync(path, patched)
  }
}

// 自检：patch 后重新解析，memory flags 必须含 shared 位、target_features 必须存在
export function verifySharedWasm(raw: Uint8Array): void {
  const { memFlags, customs } = scan(new Uint8Array(raw))
  if ((memFlags & 0x02) === 0) throw new Error('shared 注入自检失败：memory flags 缺 shared 位')
  if (!customs.has(FEATURES_NAME)) throw new Error('shared 注入自检失败：缺 target_features 段')
}
