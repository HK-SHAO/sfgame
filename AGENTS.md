# AGENTS.md

造风（sfgame-web）：Lit 3 + Canvas 2D 物理益智游戏。放置热/冷源造风，让纸飞机抵达目标。注释与 README 均为中文。

## 命令（以 package.json 为准）

- 包管理器和后台一律用 bun（`bun run` / `bunx`）
- bun 的文档在 `./node_modules/bun-types/docs`

## 类型配置

Solution-style 项目引用，改 tsconfig 或新增文件前先看：

- `tsconfig.json` — 仅 `files: []` + references；VSCode 由此加载全部子项目
- `tsconfig.app.json` — `src/`，浏览器，`types: ["vite/client"]`
- `tsconfig.node.json` — `tests/` + `vite.config.ts`，`types: ["node"]`

任何新增文件必须落在对应 config 的 `include` 内，否则 IDE 与 `tsc -b` 都不会检查它。

## 架构边界

分层不变量：**只有 `src/ui/` 接触 DOM**；`src/core/`、`src/game/`、`src/sim/` 全部无 DOM，可在 node 中无头测试（tests 只 import `game/`、`sim/` 与 `core/`；core 的浏览器面必须可注入，如 url-state 的 URL 源）。

- `src/sim/` — 物理内核（欧拉流体网格、刚体、示踪粒子）
- `src/game/` — 无头关卡逻辑：`simulation.ts`（`LevelSimulation`）、`levels.ts`、`types.ts`、`agent.ts`（开发者模式自动播放参考答案，整体可移除），测试唯一目标层
- `src/ui/` — DOM/表现层：Lit 组件（`app.ts` 根组件、`sf-game.ts` 画布宿主）、`controller.ts`（组装）、`render.ts`（canvas）、`input.ts`（手势）、`icons.ts`、`state.ts`（URL 状态 schema 单例）
- `src/core/` — 框架无关基础设施（固定步长游戏循环、音效、通用 URL 状态模块）
- `src/main.ts` — 唯一入口，只 import `./ui/app`

`sf-game.ts` 持有命令式 `GameController`：`firstUpdated` 创建、`disconnectedCallback` 销毁，HUD 经 `hudchange`/`deny` CustomEvent 外发；`app.ts` 只做声明式装配。

## Lit 易错点（本仓库实测踩坑）

- 装饰器 + `useDefineForClassFields: false`：`@query()` 只生成 getter（无 setter），字段必须用 `!` 断言且**不能带初始化器**，否则运行时报 "has only a getter"
- 不要在 `updated()`/`firstUpdated()` 内设置响应式属性，会触发 lit `change-in-update` 告警；派生状态用 `willUpdate`
- lit 模板事件名必须静态（`@hudchange=`），不能用 `@${var}=`
- 游戏生命周期已映射到元素挂载/卸载，不要再引入 `queueMicrotask`/定时器绕告警

## 玩法不变量（回归测试守护，别破坏）

- `tests/level1.test.ts`：零操作挂机不能通关（崖壁禁止"吸坡瞬移"+ 目标区必须飞行抵达）；长空跑用例带显式 `60000` 超时参数（vitest 默认 5s），新增长模拟测试必须传第三个参数
- 右键 = 放冷源：`src/ui/input.ts` 的 `onDown` 只处理 `e.button === 0`，右键走 contextmenu

## 验证策略

- 只保留 `tests/` 自动测试
- 游戏体验验证依赖用户/玩家反馈，非必要或用户要求无需自行进行 Computer Use 或 E2E 脚本验证
