// Moonbit 引擎产物引导契约：零 import、导出 memory、canary 双向握手。
// 寻址约定（导出地址 = FixedArray 数据区首）是全部零拷贝 view 的前提，
// 宿主写→内核读回、内核写→宿主读双向校验，工具链升级变更布局时响亮失败
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

interface MbExports {
  memory: WebAssembly.Memory
  canary_buf(): number
  canary_len(): number
  canary_set(i: number, v: number): void
  canary_get(i: number): number
}

function boot(): MbExports {
  const p = fileURLToPath(new URL('../app/wasm/sfengine.mbt.wasm', import.meta.url))
  const m = new WebAssembly.Module(readFileSync(p))
  // 外部宿主直调库：不允许任何 import（出现即链接契约漂移）
  expect(WebAssembly.Module.imports(m)).toHaveLength(0)
  const inst = new WebAssembly.Instance(m, {})
  return inst.exports as unknown as MbExports
}

test('零 import 且导出 memory（视图直建）', () => {
  const ex = boot()
  expect(ex.memory).toBeInstanceOf(WebAssembly.Memory)
})

test('内存容量钉死（增长被拒，宿主视图不 detach）', () => {
  const ex = boot()
  const before = ex.memory.buffer
  // min=max：运行期增长被拒（JS API 抛 RangeError），buffer 保持附着——宿主缓存视图的前提
  expect(() => ex.memory.grow(1)).toThrow(RangeError)
  expect(ex.memory.buffer).toBe(before)
})

test('canary 握手：宿主视图写 → 内核读回', () => {
  const ex = boot()
  const view = new Int32Array(ex.memory.buffer, ex.canary_buf(), ex.canary_len())
  view[0] = 0x5f3759df | 0
  view[3] = -123456
  expect(ex.canary_get(0)).toBe(0x5f3759df | 0)
  expect(ex.canary_get(3)).toBe(-123456)
})

test('canary 握手：内核写 → 宿主视图读', () => {
  const ex = boot()
  ex.canary_set(1, 424242)
  const view = new Int32Array(ex.memory.buffer, ex.canary_buf(), ex.canary_len())
  expect(view[1]).toBe(424242)
})

test('实例隔离：各实例独立内存', () => {
  const a = boot()
  const b = boot()
  a.canary_set(0, 1)
  expect(b.canary_get(0)).toBe(0)
})
