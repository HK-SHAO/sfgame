// 物理 + 渲染顶点批双内核合一入口：单 asc 编译 → 单模块单内存（流体场与顶点缓冲同址共存，
// 渲染层零拷贝直读流体内存）。两内核代码原样重导出，物理语义逐位不变。
export * from './main'
export * from './batch'
export * from './music'
