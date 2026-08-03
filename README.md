# 造风（sfgame-web）

用温度差创造风：放置热源与冷源，驱动气流，把物体吹向目标。

## 运行

```sh
bun install
bun run dev      # 开发
bun test         # 单元测试（物理内核 + 无头通关验证）
bun run build    # 类型检查 + 构建
```

## 结构

```
src/
  app.ts              Lit 根组件：标题页 / 游戏页 / HUD / 结算
  core/               框架无关的基础设施（游戏循环、音效）
  sim/                物理内核：欧拉流体网格、拉格朗日刚体、示踪粒子
  game/               关卡数据、无头模拟（Simulation）、手势输入、渲染器
tests/                bun 单元测试
```

物理内核不依赖 Canvas 与 DOM，可无头测试；渲染与输入围绕 `Simulation` 组装。
