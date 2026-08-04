# AGENTS.md

造风（sfgame-web）：Lit 3 + Canvas 2D 物理益智游戏。放置热/冷源造风，让纸飞机抵达目标。注释与 README 均为中文。

## 仓库布局（命令易踩）

- `skills/`（含 `pitfalls/SKILL.md` 避坑手册）与 `docs/` 同仓
- web 版本 app 源代码在 `sfgame-web/`，路径常需加上这个前缀

## 命令（以 package.json 为准）

- 包管理器和后台一律用 bun（`bun run` / `bunx`）；bun 文档在 `node_modules/bun-types/docs`
- `bun run check` = typecheck → test → build（fail-fast 一键验证）；`bun run test` = vitest
- 新增长模拟测试必须传显式超时第三参数（vitest 默认 5s）

## 类型配置

Solution-style 项目引用：`tsconfig.json` 仅 references；`tsconfig.app.json`（src/）、`tsconfig.node.json`（tests/ + vite.config.ts）。**新增文件必须落在对应 config 的 include 内**，否则 IDE 与 `tsc -b` 都不检查它。

## 架构边界

分层不变量：**只有 `src/ui/` 接触 DOM**；`src/core/`、`src/game/`、`src/sim/` 无 DOM，可在 node 无头测试（tests 只 import game/sim/core；core 的浏览器面必须可注入，如 url-state 的 URL 源）。

- `src/sim/` — 物理内核（欧拉流体网格、刚体、示踪粒子）
- `src/game/` — 无头关卡逻辑：`simulation.ts`（LevelSimulation）、`levels.ts`、`types.ts`、`state.ts`（URL 状态 schema 单例：level/sources/view）、`solutions.ts`（解法注册表 + solutionUrl）
- `src/ui/` — `app.ts` 根组件（声明式装配 + syncScreen 从 URL 推导屏幕）、`sf-game.ts` 画布宿主（firstUpdated 建 GameController、disconnectedCallback 销毁，事件外发 hudchange/deny/sourceschange）、`controller.ts`、`render.ts`、`input.ts`、`icons.ts`、`solutions-view.ts`
- `src/core/` — 固定步长循环、音效、通用 URL 状态模块

## 样式约定（本仓库特有，别写 px）

- 根字号在 `src/styles.css` 随视口缩放（clamp + min(vw,vh)），**组件内尺寸一律 rem**；px 仅限特殊情形（发丝线、动画位移、胶囊、媒体查询断点、env(safe-area)、阴影）
- **每个 Lit 组件须自声明 `box-sizing: border-box`**（全局样式不穿透 shadow DOM，缺了会右溢）
- 居中 + 溢出兜底用子项 `margin: auto`，禁用 `place-items: center`（溢出双向裁切）

## 易错点

实踩并验证过的坑全录在 `skills/pitfalls/SKILL.md`（按「症状 → 条目」索引：A Lit/shadow、B 布局/单位、C URL 状态、D 渲染性能、E 手势、F 音频、G 模拟/测试、H 调试方法）。**改布局/状态/性能前先查它；踩到新坑按该 skill 的扩展约定回写**（分类追加 `### Xn` + 快速检索补一行）。其中高发三项：shadow DOM 的 box-sizing（A2）、grid 百分比循环（A4）、绝对定位居中 shrink-to-fit（B4）。

## 玩法不变量（回归测试守护，别破坏）

- `tests/level1.test.ts`：零操作挂机不能通关（崖壁禁止"吸坡瞬移"+ 目标区必须飞行抵达）；`tests/solutions.test.ts`：每个解初始一次性放置必通关且与记录时间一致（±2s）
- 右键 = 放冷源：`input.ts` 的 `onDown` 只处理 `e.button === 0`，右键走 contextmenu

## 验证策略

- 保留 `tests/` 自动测试，重点测试核心模块，而非宏观
- 布局问题用 headless Chrome 数值化探针验证（方法见 pitfalls H1）
- 游戏体验验证依赖用户/玩家反馈，非必要或无用户要求，研发不得进行 Computer Use 或 E2E 脚本验证实验。这个目标是为了减少 token 浪费
