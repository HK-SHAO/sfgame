# 烧风（sfgame-web）

用温度差创造风：放置热源与冷源，让风把物体吹向目标。

## 运行

```sh
bun install
bun run dev       # 开发（自动编译 wasm 流体内核）
bun run test      # 单元测试（vitest，物理内核 + 无头通关验证）
bun run check     # fail-fast：类型检查 + 测试 + 构建
```

流体物理双后端（JS 恒可用 / WASM·SIMD 默认），两后端逐位一致，`?be=js|wasm` 可切换验证；性能对照见 `scripts/bench-backend.ts`。

## 结构

```
src/
  main.ts         入口，加载根组件
  core/           框架无关基础设施（游戏循环、音效、URL 状态）
  sim/            物理内核：欧拉流体网格、刚体、示踪粒子（无 DOM）；wasm-fluid.ts 为 WASM·SIMD 后端
  assembly/       AssemblyScript 源码：流体内核 SIMD 入口 + 标量通路（build:wasm 编译）
  game/           无头关卡逻辑：模拟、关卡数据、类型（无 DOM）
  render/         WebGL 渲染层：场景顶点批组装、GL 薄层（batch 为纯计算可无头测试）
  ui/             玩家界面：Lit 组件、控制器、手势输入、图标
  dev/            开发者工具（?dev=1）：开发面板、性能块、关卡 YAML 编辑器
tests/            vitest 单元测试
```

分层不变量：`core/`、`game/`、`sim/` 全部无头，可无头测试；DOM 仅在 `ui/` 与 `dev/`。渲染与输入围绕 `Simulation` 组装，体验验证依赖玩家反馈。
