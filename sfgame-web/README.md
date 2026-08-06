# 烧风（sfgame-web）

用温度差创造风：放置热源与冷源，让风把物体吹向目标。

## 运行

```sh
bun install
bun run dev       # 开发（自动编译 wasm 流体内核）
bun run test      # 单元测试（vitest，物理内核 + 无头通关验证）
bun run check     # fail-fast：类型检查 + 测试 + 构建
```

物理内核为 WASM 唯一实现（C 源码经 emcc 编译，-O3 -msimd128 自动向量化），不支持的环境启动时明示无法运行。编译依赖本机 emsdk（`native/build.sh` 自动 source，缺失时报错提示）。

## 结构

```
src/
  main.ts         入口：预热 WASM 流体内核后装配 UI（不支持 SIMD 时显示错误页）
  core/           框架无关基础设施（游戏循环、音效、性能治理、URL 状态）
  sim/            物理内核：欧拉流体网格（WASM）、刚体、示踪粒子（无 DOM）；fluid.ts 为引导 + 接口 + 工厂
  native/         C 源码：流体内核 engine.c + 渲染顶点批内核 batch.c（build.sh → emcc 编译）
  game/           无头关卡逻辑：模拟、关卡数据、类型（无 DOM）
  render/         WebGL 渲染层：场景顶点批组装、GL 薄层（batch 为纯计算可无头测试）
  ui/             玩家界面：Lit 组件、控制器、手势输入、图标
  dev/            开发者工具（?dev=1）：开发面板、性能块、关卡 YAML 编辑器
tests/            vitest 单元测试（setup.ts 预热 WASM 内核）
```

分层不变量：`core/`、`game/`、`sim/` 全部无头，可无头测试；DOM 仅在 `ui/` 与 `dev/`。渲染与输入围绕 `Simulation` 组装，体验验证依赖玩家反馈。
