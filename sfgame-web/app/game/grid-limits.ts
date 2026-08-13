// 网格容量镜像（moon/grid.mbt 单点）：schema 校验上限 = 内核编译期钉死容量（min=max 静态内存），
// 两侧漂移由 tests/engine-wasm.test.ts canary 双向钉死；GRID_MIN 为玩法最小可玩网格
export const GRID_MIN = 16
export const GRID_MAX_NX = 256
export const GRID_MAX_NY = 160
// 网格单元尺寸界：极端 cell 要么把网格撑爆（< 下限，运行时按格数精确拦截）、要么物理粒度过粗（> 上限）
export const CELL_MIN = 0.5
export const CELL_MAX = 1.5
