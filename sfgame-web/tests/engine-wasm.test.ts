// Moonbit 引擎产物引导契约：零 import、导出 memory、容量钉死、canary 双向握手。
// 寻址约定（导出地址 = FixedArray 数据区首）是全部零拷贝 view 的前提，
// 宿主写→内核读回、内核写→宿主读双向校验，工具链升级变更布局时响亮失败
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { GRID_MAX_NX, GRID_MAX_NY } from '../app/game/grid-limits.ts'

interface MbExports {
  memory: WebAssembly.Memory
  canary_buf(): number
  canary_len(): number
  canary_set(i: number, v: number): void
  canary_get(i: number): number
  fMaxNx(): number
  fMaxNy(): number
  tSdfCap(): number
  bTerrainFieldCap(): number
  bTerrainCap(): number
}

function boot(): MbExports {
  const p = fileURLToPath(new URL('../app/wasm/sfengine.wasm', import.meta.url))
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

// 网格容量三处同源：moon/grid.mbt（内核钉死）↔ app/game/grid-limits.ts（schema 镜像）
// 改任何一侧漏另一侧，此处响亮失败——上次事故（关卡过 --verify 但运行时超容量）即两侧脱钩
test('网格容量：内核导出与 grid-limits 镜像一致', () => {
  const ex = boot()
  expect(ex.fMaxNx()).toBe(GRID_MAX_NX)
  expect(ex.fMaxNy()).toBe(GRID_MAX_NY)
  const cells = GRID_MAX_NX * GRID_MAX_NY
  expect(ex.tSdfCap()).toBe(cells)
  expect(ex.bTerrainFieldCap()).toBe(cells)
  // marching squares 常规路径最坏 3 三角/格（三固角扇形化）= 9 顶点
  expect(ex.bTerrainCap()).toBe(cells * 9)
})

// 内核执行侧守卫的负向 canary：容量常量镜像之外，超限/非法参数必须在 init 处被拒
//（守卫被误删时门面会放行，越界读写表现为静默错误物理——此处是唯一回归守护）
test('内核守卫：超容量/非法参数 init 被拒', async () => {
  const ex = boot() as unknown as MbExports & {
    init: (...a: unknown[]) => number
  }
  const params = [0.75, 2.0, 9, 10, 3.4, 0.997, 0.99, 12, 0] as unknown[]
  expect(ex.init(GRID_MAX_NX + 1, 36, ...params)).not.toBe(0)
  expect(ex.init(48, GRID_MAX_NY + 1, ...params)).not.toBe(0)
  expect(ex.init(2, 2, ...params)).not.toBe(0)
  // margin 越界（> nx−2）与 cell 非正均被拒
  expect(ex.init(48, 36, 0.75, 2.0, 9, 10, 3.4, 0.997, 0.99, 12, 47)).not.toBe(0)
  expect(ex.init(48, 36, 0, 2.0, 9, 10, 3.4, 0.997, 0.99, 12, 0)).not.toBe(0)
  expect(ex.init(48, 36, 0.75, 2.0, 9, 10, 3.4, 0.997, 0.99, 12, 0)).toBe(0)
})
