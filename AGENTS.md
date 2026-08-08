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
- `bun run dev` = 初始编译 wasm 并监视 `assembly/` 变更自动重编（`scripts/dev.ts`，vite 检测到 wasm 变化整页刷新）+ vite；`bun run dev -- --port N` 透传 vite 参数
- `bun run build:wasm` = asc 编译单引擎：`assembly/engine.ts`（重导出流体内核 `main.ts`/`core.ts` 与顶点批内核 `batch.ts`）→ `app/wasm/sfengine.wasm`（物理+渲染同一模块同一内存；dev/test/build 均已内置，改 assembly/ 后无需手动跑）
- 新增长模拟测试必须传显式超时第三参数（vitest 默认 5s）
- 关卡工具：`bun run scripts/run-level.ts levels/level-N.json --verify … --solve … --sim N`（物理内核恒为 WASM·SIMD；详见 `skills/level-design/SKILL.md` §5-6）
- `bun run test` 通过 `tests/setup.ts` 预热 WASM 引擎（缺产物会抛错提示先 build:wasm）

## 类型配置

Solution-style 项目引用：`tsconfig.json` 仅 references；`tsconfig.app.json`（app/）、`tsconfig.node.json`（tests/ + scripts/ + vite.config.ts + app/）。**新增文件必须落在对应 config 的 include 内**，否则 IDE 与 `tsc -b` 都不检查它。

## 架构边界

分层不变量：`app/core/`、`app/game/`、`app/sim/` 无 DOM，可在 node 无头测试（tests 只 import game/sim/core、render/batch 与 wasm/engine 预热；core 的浏览器面必须可注入，如 url-state 的 URL 源）。DOM 仅在 `app/ui/`（玩家界面）与 `app/dev/`（开发者工具）；`app/render/` 是 WebGL 渲染层，其中 `batch.ts` 为纯计算可无头测试。

- `app/wasm/` — WASM 引擎引导与实例化（单实例 = 单内存；产物 `app/wasm/sfengine.wasm`，gitignore）。流体内核与顶点批内核同模块，渲染零拷贝直读流体场（`bilinearSample` 与 wasm 采样逐位同构）
- `app/sim/` — 物理内核（欧拉流体网格、纸飞机质点、示踪粒子、云）。纸飞机物理参数归口 `bodies.ts`（全游戏唯一刚体，不按实例配置）：悬停风速 HOVER_WIND = gravity/dragK 是"风 vs 重力孰大"唯一调参口径，落地不弹跳；无墙——地面是唯一边界，飞机可上天/飞出地图（用 groundExt 延展地面接住，风采样越界 clamp），飞丢即玩家自担。流体内核为 WASM·SIMD 唯一实现：`fluid.ts`（FluidLike 接口 + WasmFluid 门面 + createFluid 工厂，可注入引擎实例），`assembly/` 为 AssemblyScript 源码；内核加载失败在 main.ts 明示无法运行，绝不静默回退。环境风 = 预烘焙位流基场（地形变更时解一次 Laplace，贴地绕流/顺坡爬升）× 强度，采样时线性叠加，不进 step 流水线（潮汐 = 强度时间序列，线性叠加保幅保相）。流体域 = 地图外扩边距（`FLUID_MARGIN=10` 世界单位，左/右/上；世界↔网格换算含 origin 偏移，`buildSolidMask`/`bilinearSample` 均须带）+ 边距带 sponge 吸收层（外流能量就地衰减，防封闭盒熵增）；vorticity confinement 已移除（=0，反耗散风格化项，人工搅动源）——冷热源是熵整形装置（冷减热增），不削弱
- `app/game/` — 无头关卡逻辑：`simulation.ts`（LevelSimulation）、`state.ts`（URL 状态 schema 单例：level/sources/view）、`levels.ts`（关卡加载/分组/解锁 + lv 双形态解析 + 参考解读取）、`progress.ts`（通关记录）
- `app/ui/` — `app.ts` 根组件（声明式装配 + syncScreen 从 URL 推导屏幕，dev 面板生命周期在此）、`sf-game.ts` 画布宿主（firstUpdated 建 GameController、disconnectedCallback 销毁，事件外发 hudchange/deny/sourceschange）
- `app/render/` — `render.ts`（场景 → 顶点批组装 + 遮挡契约：太阳光晕最背景，气流粒子轨迹与太阳盘面在云后——云遮粒子与日芒、又被地面遮挡；纸飞机与其拖尾在画面顶层，不被地面遮挡，画在旗/源/风扇之后）、`gl.ts`（WebGL 薄层：单程序单缓冲、上下文状态幂等）、`batch.ts`（顶点批门面，数值实现在 `assembly/batch.ts`，静态容量零分配，可无头测试）
- `app/dev/` — ?dev=1 开发者工具：面板 + 性能块 + 关卡 JSON 编辑器（默认折叠）+ 开发者页面，由 app 持有跨关卡重建延续
- `app/core/` — 固定步长循环、音效与反馈（离散反馈一律走 `feedback.ts` 门面 = `sfx.ts` 音频 + `haptics.ts` 震动唯一配对点；连续风声层由 controller 直驱 sfx）、性能治理（`governor.ts` 降级策略 / `wind.ts` 风强度与落地判定，均纯逻辑可无头测试）、通用 URL 状态模块

## 拖尾约定（2026-08 起）

所有轨迹/拖尾——纸飞机拖尾（`sim/trail.ts`）与示踪粒子短轨迹（`sim/particles.ts`）——一律**随时间淡出**（存留 = 1 − 距写入时刻 / fadeTime），不随路程。淡出公式与常数（`PLANE_TRAIL_FADE=6s`、`TRAIL_FADE_T=5s`）统一定义在 `sim/trail.ts`；采样仍按路程等距。物体停住时旧轨迹同样老化消失。

## 样式约定（本仓库特有，别写 px）

- 根字号在 `app/styles.css` 随视口缩放（`calc(12.5px + min(0.7vw, 0.38vh))`，**无 clamp 硬限制**——字体/组件随显示尺寸等比缩放，配合密度降级保证"不可能溢出"，禁止用滚动条兜底横向溢出；px 仅限特殊情形（发丝线、动画位移、胶囊、媒体查询断点、env(safe-area)、阴影）
- 间距/圆角/控件尺寸一律用 `:root` 尺寸 token（`--sp-1..6`、`--r-sm/md/lg/xl/pill`、`--ctl-h`、`--maxw-card/dialog`、`--card-pad`、`--page-pad-x/y`、`--hud-h`、`--scroll-thumb`），**禁止新散点值**；物理计算值例外（如 hud 阴影留白）
- **每个 Lit 组件须自声明 `box-sizing: border-box`**（全局样式不穿透 shadow DOM，缺了会右溢）
- 居中 + 溢出兜底用子项 `margin: auto`，禁用 `place-items: center`（溢出双向裁切）
- **暖色背景渐变单源**：token `--bg-warm`（左上光斑）/`--bg-warm-r`（右上）定义在 `styles.css` `:root`，`html,body` 兜底携带渐变（浏览器工具栏/overscroll 露白延续渐变而非纯色带），组件内引用走 `var()`（shadow DOM 继承自定义属性），禁止内联复制渐变值
- **安全区四向齐备**：`env(safe-area-inset-top/bottom)` 之外，横屏刘海/Dynamic Island 在侧边，全宽铺满的层（hud/pageShell/.title/overlay）须同时带 left/right inset；`theme-color` 恒 = 渐变顶色 `#fff8ea`（standalone 状态栏与渐变无缝）
- PWA 安装元数据在 `public/manifest.webmanifest` + `icon.svg`（`sips` 栅格化出 icons/ 与 apple-touch-icon.png）

## 易错点

实踩并验证过的坑全录在 `skills/pitfalls/SKILL.md`（按「症状 → 条目」索引：A Lit/shadow、B 布局/单位、C URL 状态、D 渲染性能、E 手势、F 音频、G 模拟/测试、H 调试方法）。**改布局/状态/性能前先查它；踩到新坑按该 skill 的扩展约定回写**（分类追加 `### Xn` + 快速检索补一行）。其中高发三项：shadow DOM 的 box-sizing（A2）、grid 百分比循环（A4）、绝对定位居中 shrink-to-fit（B4）。

## 玩法不变量（回归测试守护，别破坏）

- 零操作挂机不能通关：抵达圆（虚线圆 = 检测圆）内滑行与飞行同等计数，故各关卡挂机轨迹必须不穿过任何抵达圆（设计红线，新关卡须用 `run-level.ts --sim` 自查；#18 起不再设自动回归）。**#25/#27 起解法与玩法验证交给玩家实测**：参考解只作为 dev 模式首页关卡项的直达摆法数据，`winTime` 不再由测试守护（solutions.test.ts 只查有解且不超预算）
- 参考解须"基本全程飞行"（贴地累计 ≤1.5s），坐标 1 位小数（URL 可放置），鲁棒性 ≥75%（见 `skills/level-design/SKILL.md` §6；该条为求解偏好，玩家求解不受此限）
- 右键 = 放冷源：`input.ts` 的 `onDown` 只处理 `e.button === 0`，右键走 contextmenu

## 验证策略

- `tests/` 保持最小集（十余秒跑完）：只测核心模块的白盒行为（流体/刚体/循环/URL 状态/关卡协议/注册解通关），不做整局玩法与 E2E；删测试可以大胆，新增须证明无可替代
- 布局问题用 headless Chrome 数值化探针验证（方法见 pitfalls H1）
- 游戏体验验证依赖用户/玩家反馈，非必要或无用户要求，研发不得进行 Computer Use 或 E2E 脚本验证实验。这个目标是为了减少 token 浪费。涉及到 UI 的不受此约束。
