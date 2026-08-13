// 世界→网格采样约定单源：烘焙在格心采样（gx = wx/cell − 0.5 + origin），
// 钳位 [0, n−1.001] 保证双线性采样恒有 4 邻域（域外取边缘值 = 地形/场自然延展）。
// 物理面≡碰撞面≡示踪采样≡渲染等值线全部依赖此约定——口径改动必须全部消费方同步，
// 位级等价性由 tests/fluid.test.ts 的「门面/内核导出逐位一致」与 engine-golden 守护

export function worldToGrid(w: number, cell: number, origin: number): number {
  return w / cell - 0.5 + origin
}

export function clampGrid(g: number, n: number): number {
  if (g < 0) return 0
  if (g > n - 1.001) return n - 1.001
  return g
}
