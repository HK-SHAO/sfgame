// 网格容量单点：流体/示踪/顶点批三内核共用同一上限——静态内存 min=max 钉死（moon.pkg memory-limits），
// 上限即每局内存水位与满网格 step 预算。改容量只动这里；JS 侧镜像在 app/game/grid-limits.ts，
// 两侧漂移由 tests/engine-wasm.test.ts canary 钉死
///|
let grid_max_nx : Int = 256

///|
let grid_max_ny : Int = 160

///|
let grid_max_cells : Int = grid_max_nx * grid_max_ny
// marching squares 常规路径最坏 3 三角/格（三固角扇形化）= 9 顶点：地形烘焙输出缓冲按此定容
//（逐格 +12 预算不变：容量临界时优雅截断，见 b_terrain_draw）

///|
let grid_terrain_verts : Int = grid_max_cells * 9
