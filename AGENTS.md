# AGENTS.md

烧风（sfgame-web）：Lit 3 + WebGL 物理益智游戏。放置热/冷源造风，让纸飞机抵达目标。注释与 README 均为中文。

## 注释约定（本仓库特有）

注释从简：代码永远看不出来的"为什么"——物理原理、不变量、协议细节、校准过的常数取舍。禁止写复述代码的文档块（函数签名、循环流程、"+1 计数"之类）。4 行以上文档注释块若只有一行有用信息，缩成一行。删除注释比添加注释更受欢迎。

**打包面零注释**：HTML/CSS/Lit（`app/ui/`、`app/dev/`、`app/main.ts`、`index.html`、`app/styles.css`）一律不写注释——代码与 token 命名自明，"为什么"沉淀到本文件与 `skills/pitfalls/SKILL.md`（如 svg tag 见 A13、样式失效见 A12）。注释只允许出现在无头层（`app/core|game|sim|render|wasm/`、`moon/`、`scripts/`、`tests/`）。

## 仓库布局

- `skills/`（含 `pitfalls/SKILL.md` 避坑手册、`level-design/SKILL.md` 关卡创作指南 + `level-design/ENGINEERING.md` 工程补充）与仓库同仓；`level-design/` 实体在 `sfgame-web/public/skills/level-design/`（仓库根 `skills/level-design` 与关卡 `levels/level.schema-1.json` 均为符号链接），随 Vite publicDir 原样发布到 `dist/skills/level-design/` 与 `dist/level.schema-1.json`（线上站点直接分发，无需构建插件）；分发的 .md 文档须带 charset 否则中文乱码（dev/preview 由 `scripts/vite-plugins/md-utf8.ts` 插件补、生产由 `public/_headers` 声明，见 pitfalls I11）
- web 版本 app 源代码在 `sfgame-web/`，路径常需加上这个前缀

## 命令（以 package.json 为准）

- 包管理器和后台一律用 bun（`bun run` / `bunx`）；bun 文档在 `node_modules/bun-types/docs`。脚本/插件运行时入口一律 bun（`bun run scripts/…`）；vite 经 `scripts/vite.mjs` 门面以 bun 运行时执行（`bun vite` 会尊重 bin 的 node shebang 而落到 node，config 内 Bun 全局失效；门面直接 import 入口绕过 shebang——wasm-rebuild 插件依赖 Bun）
- 依赖经根 `package.json` workspaces（sfgame-web + cloudflare）统一管理：根目录一次 `bun install` 装齐，单一根 `bun.lock`；新依赖加到对应子包 package.json 后根目录重装
- `bun run check` = typecheck → build → test（fail-fast 一键验证，顺序与语义以 package.json 为准；build 前置 build:wasm，故 test 恒有产物）；`bun run test` = test:moon + vitest **双运行时**（node/V8 为权威基线 + bun/JSC 为 Safari 代理检测器，全量必跑，见 pitfalls I8）；根目录亦有同名透传脚本（--cwd sfgame-web），可在仓库根直接跑
- `bun run dev` = vite（`scripts/vite-plugins/wasm-rebuild.ts` 插件：启动前编译 wasm 一次 + 复用 vite 的 chokidar 监视 `moon/` 变更自动重编，产物变化整页刷新）；`bun run dev -- --port N` 透传 vite 参数
- `bun run build:wasm` = Moonbit 数值内核编译（moon 工具链需先装），wasm 单目标出单产物（dev/build/check 已内置，改 moon/ 后无需手动跑）：
  - wasm 目标 → `app/wasm/sfengine.wasm`（流体+顶点批+示踪三内核单模块单内存；SDF 表达式求值器为纯 TS `app/game/sdf.ts`，不经 moon）；产物经 `scripts/patch-shared.ts` 二进制注入共享内存位（memory flags 0x01→0x03 + target_features 段，SAB 跨线程零拷贝的前提，纯字节操作不改内核）
- `bun run test:moon` = moon 模块单元/白盒测试（wasm 引擎包，含 ffi 寻址约定与内核不变量）
- `bun run bench:moon` = 内核性能基线（moon bench；分阶段基准见 `moon/bench_wbtest.mbt`：满网格流体步 ≈3.7ms @ 256×160 = 平流 MacCormack 58% + GS 28% + 其余 14%；GS f64x2 双格 SIMD + buoyancy 双格 SIMD；无地形纯空域路径由内核门控自动转标量——JSC 对该路径的 gs_pair 误编译已被语义层隔离，见 pitfalls I8）
- 新增长模拟测试必须传显式超时第三参数（vitest 默认 5s）
- 关卡工具：`bun run scripts/run-level.ts levels/level-N.json --verify … --solve … --sim N`（物理内核恒为 WASM·Moonbit 内核；设计口径见 `skills/level-design/SKILL.md`，工具链见 `skills/level-design/ENGINEERING.md`）
- `bun run test` 不编译 wasm：vitest 的 tests/setup.ts 预热 WASM 引擎，缺产物即抛错（产物 gitignore）——先 `bun run build:wasm`，或跑过一次 build/dev/check 产物即恒在；直跑 `vitest run`（不经脚本）同理

## 类型配置

Solution-style 项目引用：`tsconfig.json` 仅 references；`tsconfig.app.json`（app/）、`tsconfig.node.json`（tests/ + scripts/ + vite.config.ts + app/）。**新增文件必须落在对应 config 的 include 内**，否则 IDE 与 `tsc -b` 都不检查它。

## 架构边界

分层不变量：`app/core/`、`app/game/`、`app/sim/` 无 DOM，可在 node 无头测试（tests 只 import game/sim/core、render/batch 与 wasm/engine 预热；core 的浏览器面必须可注入，如 url-state 的 URL 源）。DOM 仅在 `app/ui/`（玩家界面）与 `app/dev/`（开发者工具）；`app/render/` 是 WebGL 渲染层，其中 `batch.ts` 为纯计算可无头测试。

- `app/wasm/` — WASM 引擎引导与实例化（单实例 = 单内存；产物 `app/wasm/sfengine.wasm`，gitignore）。流体+顶点批+示踪三内核同模块，主线程经 SAB 零拷贝直读流体场与示踪缓冲（`bilinearSample` 与 wasm 采样语义同构、f32 容差内一致）。SAB 要求跨域隔离 COOP/COEP（`public/_headers` 生产 + vite.config 的 server/preview 头已配；缺一则共享内存实例化失败）
- `moon/` — Moonbit 数值内核模块（AssemblyScript 已于 2026-08 迁出），wasm 单目标：根包流体/顶点批/示踪三内核只编 wasm（foreign_library 零 import、静态内存零运行期分配 min=max 钉死容量——增长会 detach 宿主视图、FixedArray 数据区首地址经导出函数交宿主建零拷贝 view，非文档化 ABI 由 tests/engine-wasm.test.ts canary 握手守护；**网格上限单点在 `moon/grid.mbt`（256×160，JS 镜像 `app/game/grid-limits.ts`，canary 双向钉死，schema 校验与内核同源）**）。SDF 表达式求值器为纯 TS（`app/game/sdf.ts`，f64 + 跨平台位级一致：不用 Math.hypot 改 sqrt(a²+b²)，trig/exp 走原生 Math 由 f32 场存储抹平 ulp 差；语义基线 tests/sdf-golden.json）。数值基线：tests/engine-golden.test.ts（引擎 FNV hash）与 tests/sdf-golden.json（sdf 确定性算术逐位网格）
- `app/sim/` — 物理内核（欧拉流体网格、纸飞机质点、示踪粒子、云）。纸飞机物理参数归口 `bodies.ts`（全游戏唯一刚体，不按实例配置）：悬停风速 HOVER_WIND = gravity/dragK 是"风 vs 重力孰大"唯一调参口径；接触解算 = 法向投影 + 切向库仑摩擦（μ=0.3，摩擦角 ≈16.7°：切向重力生效，比摩擦角陡的坡无风下滑、垂直墙不可穿透），落地不弹跳；无墙——地形 SDF 是唯一边界，全域有定义天然延展，飞机可上天/飞出地图，飞丢即玩家自担。地形 = `terrain.ts` 烘焙场（加载期把 `terrain.sdf` 表达式烘焙到流体同规格网格，单一事实源：流体固体掩码经 `setTerrain` 注入、飞机碰撞/放源吸附、示踪粒子 2D 采样、渲染逐顶点着色采样同一份场；SDF 表达式内核 = 纯 TS `app/game/sdf.ts`（f64，跨平台位级一致：原语皆精确距离 + min/max/smin/smax 组合，可表达洞穴/悬挑；距离用 sqrt(a²+b²) 而非 Math.hypot——后者 V8/JSC 末位不一致；trig/exp 用原生 Math，跨引擎 ≤1 ulp 经 f32 场存储抹平，语义漂移由 sdf-golden 近似容差守护））。流体内核为 WASM 唯一实现（Moonbit 内核，f32 存储 / f64 中间量——精度优先，混沌流场下位漂移需钉死；GS 用 f64x2 双格 SIMD 位精确加速（拆分子文件 `moon/fluid_simd.mbt`，白盒测试钉死与标量逐位等价；无实体纯空域关卡由内核在 build_air_lists 门控自动转标量——该全 bulk 路径在 JSC 误编译，见 pitfalls I8））：`fluid.ts`（FluidLike 接口 + WasmFluid 门面 + createFluid 工厂，可注入引擎实例），数值源码在 `moon/`；内核加载失败在 main.ts 明示无法运行，绝不静默回退。数值输出由 tests/engine-golden.test.ts 的 golden hash 钉死在迁移基线——混沌流场下位漂移会改变已录通关耗时的可复现性，改物理必须先人工确认再更新基线。环境风 = 预烘焙位流基场（地形变更时解一次 Laplace，贴地绕流/顺坡爬升）× 强度，采样时线性叠加，不进 step 流水线（潮汐 = 强度时间序列，线性叠加保幅保相）。流体域 = 地图外扩边距（`FLUID_MARGIN=10` 世界单位，左/右/上；世界↔网格换算含 origin 偏移，地形烘焙场与 `bilinearSample` 均须带）+ 边距带 sponge 吸收层（外流能量就地衰减，防封闭盒熵增）；vorticity confinement 已移除（=0，反耗散风格化项，人工搅动源）——冷热源是熵整形装置（冷减热增），不削弱。模拟整体运行在专用 worker（`sim-worker.ts`，位于 app/sim 下但为 worker 上下文：postMessage + 自建 wasm 实例，无 window/document，无 DOM 边界不破）：主线程只发消息、消费帧快照渲染（协议与跨线程着色常数单源在 `worker-protocol.ts`）；引擎实例跨关卡复用（fluid_init 全量复位已保证安全）
- `app/game/` — 无头关卡逻辑：`simulation.ts`（LevelSimulation）、`state.ts`（URL 状态 schema 单例：lv/s/v/dev）、`levels.ts`（关卡加载/分组/解锁 + lv 双形态解析 + 关卡内容 hash）、`progress.ts`（通关记录：每关最佳总耗时与关卡 hash 绑定）
- `app/ui/` — `app.ts` 根组件（声明式装配 + syncScreen 从 URL 推导屏幕，dev 面板生命周期在此）、`sf-game.ts` 画布宿主（firstUpdated 建 GameController、disconnectedCallback 销毁，事件外发 hudchange/deny/sourceschange）。`controller.ts` 只发消息驱动模拟 worker 并消费其帧快照渲染（快照协议与跨线程常数见 `app/sim/worker-protocol.ts`）；hitSource 用快照镜像复刻同值判定（SOURCE_HIT_RADIUS）
- `app/render/` — `render.ts`（场景 → 顶点批组装 + 遮挡契约：太阳光晕最背景，气流粒子轨迹与太阳盘面在云后——云遮粒子与日芒、又被地面遮挡；纸飞机与其拖尾在画面顶层，不被地面遮挡，画在旗/源/风扇之后；地形 = marching squares 固体填充：烘焙格心 SDF 场每关上传顶点批内核一次，每帧按视域单调用切 d=0 等值线（格内线性插值，矢量级锐边，鞍点拆独立三角、越界格钳场外推延展；地表色=旧描边色按 SDF 深度指数渐近混向原填充色，特征长度 GROUND_DEPTH_LEN=8））、`gl.ts`（WebGL 薄层：单程序单缓冲、上下文状态幂等）、`batch.ts`（顶点批门面，数值实现在 `moon/batch.mbt`，静态容量零分配，可无头测试）
- `app/dev/` — ?dev=1 开发者工具：面板 + 性能块 + 关卡 JSON 编辑器（默认折叠）+ 开发者页面，由 app 持有跨关卡重建延续；dev 会话不进入 GA 上报（无限源/倍速会污染正式漏斗与转化率）
- `app/core/` — 固定步长循环、音效与反馈（离散反馈一律走 `feedback.ts` 门面 = `sfx.ts` 音频 + `haptics.ts` 震动唯一配对点；连续风声层由 controller 直驱 sfx）、性能治理（`governor.ts` 降级策略 / `wind.ts` 风强度与落地判定，均纯逻辑可无头测试）、通用 URL 状态模块、分析上报门面（`analytics.ts` 语义 schema + 可注入 transport，传输适配器在 `ui/analytics-gtag.ts`——换上报服务只改适配器 + main.ts 装配）

## 拖尾约定（2026-08 起）

所有轨迹/拖尾——纸飞机拖尾（`sim/trail.ts`）与示踪粒子短轨迹（`sim/particles.ts`）——一律**随时间淡出**（存留 = 1 − 距写入时刻 / fadeTime），不随路程。淡出公式与常数（`PLANE_TRAIL_FADE=6s`、`TRAIL_FADE_T=5s`）统一定义在 `sim/trail.ts`；采样仍按路程等距。物体停住时旧轨迹同样老化消失。

## 样式约定（本仓库特有，别写 px）

- 根字号在 `app/styles.css` 随视口缩放（`calc(12.5px + min(0.7vw, 0.38vh))`，**无 clamp 硬限制**——字体/组件随显示尺寸等比缩放，配合密度降级保证"不可能溢出"，禁止用滚动条兜底横向溢出；px 仅限特殊情形（发丝线、动画位移、胶囊、媒体查询断点、env(safe-area)、阴影）
- 间距/圆角/控件尺寸一律用 `:root` 尺寸 token（`--sp-1..6`、`--r-sm/md/lg/xl/pill`、`--ctl-h`、`--maxw-card/dialog`、`--card-pad`、`--page-pad-x/y`、`--hud-h`、`--scroll-thumb`），**禁止新散点值**；物理计算值例外（如 hud 阴影留白）
- 圆角形状语义（Apple 语系，同类同形）：**胶囊**（`--r-pill`）= 徽章/状态 chip、短标签按钮、分段页签、开关轨道——只写 `border-radius`，不写 `corner-shape`；**正圆**（50%）= 旋钮/点状反馈——同样不写 `corner-shape`；**连续曲率**（`corner-shape: squircle`）只用于大表面与横幅（卡片/弹层/提示条，`--r-lg/xl`）且仅 Chromium 渲染、Safari 自动回落普通圆角——语义不得依赖它；`--r-sm/md` 小控件两种写法视觉等价，保留 squircle 统一写法
- **每个 Lit 组件须自声明 `box-sizing: border-box`**（全局样式不穿透 shadow DOM，缺了会右溢）
- 居中 + 溢出兜底用子项 `margin: auto`，禁用 `place-items: center`（溢出双向裁切）
- **暖色背景渐变单源**：token `--bg-warm`（左上光斑）/`--bg-warm-r`（右上）定义在 `styles.css` `:root`，`html,body` 兜底携带渐变（浏览器工具栏/overscroll 露白延续渐变而非纯色带），组件内引用走 `var()`（shadow DOM 继承自定义属性），禁止内联复制渐变值
- **安全区四向齐备**：`env(safe-area-inset-top/bottom)` 之外，横屏刘海/Dynamic Island 在侧边，全宽铺满的层（hud/pageShell/.title/overlay）须同时带 left/right inset；`theme-color` 恒 = 渐变顶色 `#fff8ea`（standalone 状态栏与渐变无缝）
- PWA 安装元数据在 `public/manifest.webmanifest` + `icon.svg`（`sips` 栅格化出 icons/ 与 apple-touch-icon.png）

## 易错点

实踩并验证过的坑全录在 `skills/pitfalls/SKILL.md`（按「症状 → 条目」索引：A Lit/shadow、B 布局/单位、C URL 状态、D 渲染性能、E 手势、F 音频、G 模拟/测试、H 调试方法）。**改布局/状态/性能前先查它；踩到新坑按该 skill 的扩展约定回写**（分类追加 `### Xn` + 快速检索补一行）。其中高发三项：shadow DOM 的 box-sizing（A2）、grid 百分比循环（A4）、绝对定位居中 shrink-to-fit（B4）。

## 玩法不变量（回归测试守护，别破坏）

- 零操作挂机不能通关：抵达圆（虚线圆 = 检测圆）内滑行与飞行同等计数，故各关卡挂机轨迹必须不穿过任何抵达圆（设计红线，新关卡须用 `run-level.ts --sim` 自查；#18 起不再设自动回归）。**解法不随关卡文件发布**（免翻代码作弊）：只记最佳过关耗时（progress.ts：单条最佳、与关卡内容 FNV hash 绑定、localStorage 持久化），不记录解摆法、进关不预置
- 求解器偏好（`run-level.ts --solve` 离线工具，产物不入库）：只比**总耗时**（通关时间 + 源罚 4s/个 + 贴地罚 1s/s，罚时与游戏同源见 `app/game/timer.ts`；贴地罚时是软成本，爬行解自动吃亏，无硬性飞行门槛），坐标 1 位小数（URL 可放置），鲁棒性 ≥75%（求解口径见 `skills/level-design/ENGINEERING.md`）
- 右键 = 放冷源：`input.ts` 的 `onDown` 只处理 `e.button === 0`，右键走 contextmenu

## 验证策略

- `tests/` 保持最小集（十余秒跑完）：只测核心模块的白盒行为（流体/刚体/循环/URL 状态/关卡协议/注册解通关/引擎位稳定性 golden hash），不做整局玩法与 E2E；删测试可以大胆，新增须证明无可替代
- 布局问题用 headless Chrome 数值化探针验证（方法见 pitfalls H1）
- 游戏体验验证依赖用户/玩家反馈，非必要或无用户要求，研发不得进行 Computer Use 或 E2E 脚本验证实验。这个目标是为了减少 token 浪费。涉及到 UI 的不受此约束。
