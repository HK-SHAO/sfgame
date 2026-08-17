// wasm memory 段 limits flags 读写（threads 提案：bit1 = shared）。
// 构建期 scripts/patch-shared.ts 置位（SAB 零拷贝前提）；运行期 engine.ts 在无 SAB 能力环境清位，
// 回退普通内存实例化。标志位为纯元数据，不改数值语义——golden 契约不受模式影响。

const SHARED_BIT = 0x02

export interface MemFlagLoc {
  off: number
  flags: number
}

// LEB128 无符号读取：返回 [值, 游标]
function readLeb(buf: Uint8Array, i: number): [number, number] {
  let v = 0
  let shift = 0
  while (true) {
    const b = buf[i++]
    v |= (b & 0x7f) << shift
    if ((b & 0x80) === 0) break
    shift += 7
  }
  return [v, i]
}

// 全量遍历段定位 memory 段 flags：布局漂移即抛错（不盲改），未找到时 off = -1
export function scanMemoryFlags(buf: Uint8Array): MemFlagLoc {
  if (buf[0] !== 0x00 || buf[1] !== 0x61 || buf[2] !== 0x73 || buf[3] !== 0x6d) {
    throw new Error('wasm-memory：非 wasm 魔数')
  }
  if (buf[4] !== 0x01 || buf[5] !== 0x00 || buf[6] !== 0x00 || buf[7] !== 0x00) {
    throw new Error('wasm-memory：非 wasm 1.0 版本')
  }
  let off = 8
  let loc: MemFlagLoc = { off: -1, flags: -1 }
  while (off < buf.length) {
    const [id, i0] = readLeb(buf, off)
    const [size, start] = readLeb(buf, i0)
    if (id === 5) {
      // memory 段：count(1) + limits(flags [+min [+max]])
      if (buf[start] !== 1) throw new Error('wasm-memory：memory 段 count ≠ 1')
      const [flags] = readLeb(buf, start + 1)
      loc = { off: start + 1, flags }
    }
    off = start + size
  }
  if (off !== buf.length) throw new Error('wasm-memory：段遍历未对齐文件尾')
  return loc
}

// 就地置位/清位 shared（幂等），返回原数组
export function setSharedFlag(buf: Uint8Array, on: boolean): Uint8Array {
  const { off, flags } = scanMemoryFlags(buf)
  if (off < 0) throw new Error('wasm-memory：未找到 memory 段')
  const next = on ? flags | SHARED_BIT : flags & ~SHARED_BIT
  if (next !== flags) buf[off] = next
  return buf
}

export function hasSharedFlag(buf: Uint8Array): boolean {
  return (scanMemoryFlags(buf).flags & SHARED_BIT) !== 0
}
