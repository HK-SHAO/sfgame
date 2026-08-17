// 共享内存注入：moonc 产出的 wasm 是普通（非 shared）Memory；SAB 跨线程零拷贝要求
// Memory 带 shared 位。flags 读写单源在 app/wasm/wasm-shared.ts（运行期 engine.ts 在
// 无 SAB 能力环境做反向清位回退，同一份段解析两端共用）。
// 不追加 target_features 段：三大引擎（V8/JSC/SM）源码均不消费，
// 消费方只有链接器（wasm-ld/binaryen），而本产物是终产物不经链接；该段的规范编码是
// count 前缀 + 特性名字符串（tool-conventions），曾误写数字 ID 会令 wasm-opt 严格解析报错，故删。
// 纯字节操作不经 wasm 重编译：moon/ 与引擎源码零改动，golden 契约不破。
import { readFileSync, writeFileSync } from 'node:fs'
import { hasSharedFlag, scanMemoryFlags, setSharedFlag } from '../app/wasm/wasm-shared.ts'

// 对磁盘上的 wasm 文件执行共享注入（幂等：已带 shared 位则零改动）
export function patchSharedWasm(path: string): void {
  const buf = new Uint8Array(readFileSync(path))
  const { off, flags } = scanMemoryFlags(buf)
  if (off < 0) throw new Error('shared 注入：未找到 memory 段')
  // moonc 产物恒 has_max（min=max 静态容量钉死）；shared 位置入前必须为 0x01，防布局漂移静默错位
  if (flags !== 1 && flags !== 3) {
    throw new Error(`shared 注入：memory flags=${flags}（期望 0x01），wasm 布局漂移，构建中止`)
  }
  if (flags === 1) writeFileSync(path, setSharedFlag(buf, true))
  verifySharedWasm(readFileSync(path))
}

// 自检：patch 后重新解析，memory flags 必须含 shared 位
export function verifySharedWasm(raw: Uint8Array): void {
  if (!hasSharedFlag(new Uint8Array(raw))) throw new Error('shared 注入自检失败：memory flags 缺 shared 位')
}
