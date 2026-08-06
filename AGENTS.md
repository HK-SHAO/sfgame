# AGENTS.md

烧风（sfgame-web）：Lit 3 + WebGL 物理益智游戏。放置热/冷源造风，让纸飞机抵达目标。注释与 README 均为中文。

## 注释约定（本仓库特有）

注释从简：代码永远看不出来的"为什么"——物理原理、不变量、协议细节、校准过的常数取舍。禁止写复述代码的文档块（函数签名、循环流程、"+1 计数"之类）。4 行以上文档注释块若只有一行有用信息，缩成一行。删除注释比添加注释更受欢迎。

## 仓库布局

- `skills/`（含 `pitfalls/SKILL.md` 避坑手册、`level-design/SKILL.md` 关卡搭建指南）与 `docs/` 同仓
- web 版本 app 源代码在 `sfgame-web/`，路径常需加上这个前缀
- 要重点参考 `docs/development.md`

## 命令（以 package.json 为准）

- 包管理器和后台一律用 bun（`bun run` / `bunx`）；bun 文档在 `node_modules/bun-types/docs`
- `bun run check` = typecheck → test → build（fail-fast 一键验证）；`bun run test` = vitest
- `bun run build:wasm` = asc 编译 `assembly/main.ts` → `src/sim/wasm/sfsim.wasm`（dev/test/build 均已内置，改 assembly/ 后无需手动跑）
- 新增长模拟测试必须传显式超时第三参数（vitest 默认 5s）
- 关卡工具：`bun run scripts/run-level.ts levels/level-N.yaml --verify … --solve … --sim N`（物理内核恒为 WASM·SIMD；详见 `skills/level-design/SKILL.md` §5-6）
- `bun run test` 通过 `tests/setup.ts` 预热 WASM 流体内核（缺产物会抛错提示先 build:wasm）

## 类型配置

Solution-style 项目引用：`tsconfig.json` 仅 references；`tsconfig.app.json`（src/）、`tsconfig.node.json`（tests/ + scripts/ + vite.config.ts + src/）。**新增文件必须落在对应 config 的 include 内**，否则 IDE 与 `tsc -b` 都不检查它。

## 架构边界

分层不变量：`src/core/`、`src/game/`、`src/sim/` 无 DOM，可在 node 无头测试（tests 只 import game/sim/core 与 render/batch；core 的浏览器面必须可注入，如 url-state 的 URL 源）。DOM 仅在 `src/ui/`（玩家界面）与 `src/dev/`（开发者工具）；`src/render/` 是 WebGL 渲染层，其中 `batch.ts` 为纯计算可无头测试。

- `src/sim/` — 物理内核（欧拉流体网格、刚体、示踪粒子、云）。流体内核为 WASM·SIMD 唯一实现：`fluid.ts`（引导 + 包装 + FluidLike 接口 + 工厂）、`assembly/` 为 AssemblyScript 源码（`main.ts` 入口 + `core.ts` 状态/标量通路），编译产物 `src/sim/wasm/sfsim.wasm`（gitignore）；不支持 WASM·SIMD 的环境在 main.ts 明示无法运行，绝不静默回退
- `src/game/` — 无头关卡逻辑：`simulation.ts`（LevelSimulation）、`levels.ts`、`types.ts`、`state.ts`（URL 状态 schema 单例：level/sources/view）、`solutions.ts`（解法注册表 + solutionUrl）、`session.ts`（会话级关卡覆写：dev 面板 YAML 编辑，不落盘）
- `src/ui/` — `app.ts` 根组件（声明式装配 + syncScreen 从 URL 推导屏幕，dev 面板生命周期在此）、`sf-game.ts` 画布宿主（firstUpdated 建 GameController、disconnectedCallback 销毁，事件外发 hudchange/deny/sourceschange）、`controller.ts`、`input.ts`、`icons.ts`、`solutions-view.ts`、`storage-view.ts`、`status-bar.ts`
- `src/render/` — `render.ts`（场景 → 顶点批组装）、`gl.ts`（WebGL 薄层：单程序单缓冲、上下文状态幂等）、`batch.ts`（纯计算即时模式网格构建器）
- `src/dev/` — ?dev=1 开发者工具：`devtools.ts`（组装：面板 + 性能块 + 编辑器，由 app 持有跨关卡重建延续）、`dev-panel.ts`（面板外壳：拖拽手柄 + 分割线 + slot 装配，主题经 --dev-* 变量共享）、`perf.ts`（性能块）、`level-editor.ts`（关卡 YAML 临时编辑器，默认折叠）、`dev-menu.ts`（开发者页面）
- `src/core/` — 固定步长循环、音效、通用 URL 状态模块

## 拖尾约定（2026-08 起）

所有轨迹/拖尾——纸飞机拖尾（`sim/trail.ts`）与示踪粒子短轨迹（`sim/particles.ts`）——一律**随时间淡出**（存留 = 1 − 距写入时刻 / fadeTime），不随路程。飞机 `PLANE_TRAIL_FADE=6s`、粒子 `TRAIL_FADE_T=5s`；采样仍按路程等距。物体停住时旧轨迹同样老化消失。

## 样式约定（本仓库特有，别写 px）

- 根字号在 `src/styles.css` 随视口缩放（clamp + min(vw,vh)），**组件内尺寸一律 rem**；px 仅限特殊情形（发丝线、动画位移、胶囊、媒体查询断点、env(safe-area)、阴影）
- **每个 Lit 组件须自声明 `box-sizing: border-box`**（全局样式不穿透 shadow DOM，缺了会右溢）
- 居中 + 溢出兜底用子项 `margin: auto`，禁用 `place-items: center`（溢出双向裁切）

## 易错点

实踩并验证过的坑全录在 `skills/pitfalls/SKILL.md`（按「症状 → 条目」索引：A Lit/shadow、B 布局/单位、C URL 状态、D 渲染性能、E 手势、F 音频、G 模拟/测试、H 调试方法）。**改布局/状态/性能前先查它；踩到新坑按该 skill 的扩展约定回写**（分类追加 `### Xn` + 快速检索补一行）。其中高发三项：shadow DOM 的 box-sizing（A2）、grid 百分比循环（A4）、绝对定位居中 shrink-to-fit（B4）。

## 玩法不变量（回归测试守护，别破坏）

- 零操作挂机不能通关：抵达圆（虚线圆 = 检测圆）内滑行与飞行同等计数，故各关卡挂机轨迹必须不穿过任何抵达圆（设计红线，新关卡须用 `run-level.ts --sim` 自查；#18 起不再设自动回归）；每个解初始一次性放置必通关且与记录时间一致（±2s，`tests/solutions.test.ts` 守护）
- 参考解须"基本全程飞行"（贴地累计 ≤1.5s），坐标 1 位小数（URL 可放置），鲁棒性 ≥75%（见 `skills/level-design/SKILL.md` §6）
- 右键 = 放冷源：`input.ts` 的 `onDown` 只处理 `e.button === 0`，右键走 contextmenu

## 验证策略

- `tests/` 保持最小集（#18/#19 精简至 ~36 项、十余秒跑完）：只测核心模块的白盒行为（流体/刚体/循环/URL 状态/关卡协议/注册解通关），不做整局玩法与 E2E；删测试可以大胆，新增须证明无可替代
- 布局问题用 headless Chrome 数值化探针验证（方法见 pitfalls H1）
- 游戏体验验证依赖用户/玩家反馈，非必要或无用户要求，研发不得进行 Computer Use 或 E2E 脚本验证实验。这个目标是为了减少 token 浪费。涉及到 UI 的不受此约束。
