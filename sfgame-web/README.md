# 造风（sfgame-web）

用温度差创造风：放置热源与冷源，驱动气流，把物体吹向目标。

## 运行

```sh
bun install
bun run dev       # 开发
bun run test      # 单元测试（vitest，物理内核 + 无头通关验证）
bun run check     # fail-fast：类型检查 + 测试 + 构建
```

## 结构

```
src/
  main.ts         入口，加载根组件
  core/           框架无关基础设施（游戏循环、音效）
  sim/            物理内核：欧拉流体网格、刚体、示踪粒子（无 DOM）
  game/           无头关卡逻辑：模拟、关卡数据、类型（无 DOM）
  ui/             DOM/表现层：Lit 组件、控制器、渲染器、手势输入、图标
tests/            vitest 单元测试
```

分层不变量：只有 `src/ui/` 接触 DOM；`core/`、`game/`、`sim/` 全部无头，可无头测试。渲染与输入围绕 `Simulation` 组装，体验验证依赖玩家反馈。
