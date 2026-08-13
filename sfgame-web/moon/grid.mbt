// 网格容量单点：流体/示踪/顶点批三内核共用同一上限——静态内存 min=max 钉死（moon.pkg memory-limits），
// 上限即每局内存水位与满网格 step 预算。改容量只动这里；JS 侧镜像在 app/game/grid-limits.ts，
// 两侧漂移由 tests/engine-wasm.test.ts canary 钉死
let grid_max_nx : Int = 256
let grid_max_ny : Int = 160
let grid_max_cells : Int = grid_max_nx * grid_max_ny
// marching squares 最坏全实体每格 2 三角 = 6 顶点：地形烘焙输出缓冲按此定容
let grid_terrain_verts : Int = grid_max_cells * 6
