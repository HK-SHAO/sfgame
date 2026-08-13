# 烧风仓库第二轮评审报告：性能 · 简化 · 模块化 · 内聚 · 样式统一

> 基线：CR 修复后的当前状态（63 文件已变更、120 vitest 用例全绿、golden 零漂移）
> 方法：8 个领域代理全量深读 + 逐条定量证据 + 三条红线（正确性/玩家体验/物理真实）逐条核验 + 关键主张本会话抽查复核
> 结论性质：**研究报告，未改动任何代码**

## 1. 执行摘要

**总体判断：修复后的仓库在性能纪律上已接近"无可优化"——热路径零分配（每帧仅 2 个小对象）、零拷贝采样（JS bilinearSample 与内核逐位同构、双层 parity 测试钉死）、跨界收敛（bTracers 单调用、每 tick ~12-15 次小额调用）、内存静态定型（32MB 钉死、canary 防 detach）。本轮 61 条原始建议的分布本身就是结论：adopt ~20 / consider ~24 / avoid ~17——**约 1/3 的"优化直觉"经逐条验证是陷阱**。**

真实收益集中在五个方向，全部是位级等价或纯结构改动，无一触碰 golden/canary/确定性物理：

1. **一个真实缺陷**：`loop.ts` 的 setTimeout 让出批次逃逸 frame 的 try/catch（K5-01）——16x 追赶帧下 tick 抛错会从"干净停机"退化为**无诊断的永久静默冻结**（已实测复刻）。
2. **样式/样板收敛**（~150 行重复 + 6 处散点）：玻璃配方 12 处档位漂移、胶囊链接钮双份逐行复制、button 重置三份、图标工厂化省 ~100 行（K4-01/02/03/08/09、K8-01/02/04/05）。
3. **工具链死代码与浪费**：求解器 pathLen 死计算、KNOWN_SOLUTIONS 指标零消费且 --verify-known 不比对、GA 精英个体每代重评（~20% 墙钟空转）（K7-01/02/03/04）。
4. **模块化单源化**：采样公式 5 处手写、marginCells 双实现、顶点 stride 双份、LevelDef 手工重复声明（K2-01/02、K1-06、K6-03）。
5. **唯一有量级感知的性能项**：太阳光晕完全静态却每帧以 ~56% 屏占比做渐变混合填充，可并入背景烘焙（K3-05）。

**陷阱清单**（本轮独特价值，防未来误操作）：潮汐相位增量、源批量注入、固体格跳过浮力、FNV 双实现合并、wasm 内存缩减、GL 状态去重、subarray 消除、url-state 状态机合并、base64 查表、import.meta.glob 切换——每条都有明确的位漂移/语义回归论证。

## 2. 建议总表（按 ROI 排序）

### Adopt（值得做，风险低）

| ID | 标题 | 文件 | 定量收益 | 风险 |
|---|---|---|---|---|
| K5-01 | loop 让出批次逃逸 try/catch → 异常静默冻结 | loop.ts:88 | 错误路径从无诊断冻结 → 干净停机；~5 行 | low |
| K2-01 | 采样公式 + 1.001 钳位 5 处手写 → sim/grid.ts 单源 | terrain.ts:67 | 消除静默错位风险面；位级等价 | low |
| K3-02 | draw() 70 行拆 drawBackground/drawTerrainPass | render.ts:167 | 编排可读性；纯移动 | none |
| K4-01 | 玻璃胶囊配方 5 处手写 → glassChip 共享块 | hud.ts:180 | ~25 行重复 + 4 档透明度漂移 | low |
| K4-03 | 15 个 SVG 图标样板工厂化 | icons.ts:4-193 | 省 ~100 行样板 | low |
| K8-02 | 胶囊链接钮双份逐行复制（注释自认）→ pillLink | about-card.ts:191 | 消除漂移对；19 行×2 | none |
| K8-04 | button 重置配方 3 份 → buttonReset 共享 | title-screen.ts:206 | ~33 行重复 + active 缩放已漂移 | none |
| K7-01 | pathLen 死计算（全仓零消费） | solve-lib.ts | 纯删；热循环减负 | none |
| K7-02 | KNOWN_SOLUTIONS 指标零消费 + --verify-known 补比对 | known-solutions.ts | 回归基线恢复"发现漂移"能力 | none |
| K6-01 | resolveLevel({json}) 单槽缓存（防重复烘焙+身份抖动） | levels.ts:89 | dev/DIY 路径省 1-3ms/次 + keyed 免误重建 | none |
| K6-02 | 内置关卡 hash 预计算（标题页每渲染 40 次 FNV） | levels.ts:111 | 冷路径整洁；值逐位不变 | none |
| K6-03 | LevelDef 用 Omit 从 LevelJson 单源派生 | types.ts | 双份手工声明合一 | none |
| K1-05 | margin→格数换算双实现 → marginCells 单源 | terrain.ts/fluid.ts | 消除 origin 分叉风险面 | low |
| K1-06 | 顶点 stride 双份无 canary → 导出 bVertexStride | batch.ts/moon | 消除 ABI 漂移面（tracer stride 已有先例） | low |
| K2-10 | 贴地阈值裸字面量 1 → GROUNDED_ALT 具名 | simulation.ts:245 | 罚时口径单点 | none |
| K3-04 | tracerStride/tracerCap getter 每帧打 wasm → 构造期缓存 | batch.ts:107 | 2 次跨界/帧，零成本 | none |
| K3-09 | SUN_POS 唯一对象字面量 → readonly 元组统一 | render.ts:55 | 常量区风格一致 | none |
| K4-04 | sf-game 每帧重算 levelNo（20 次 findIndex）→ 缓存 | sf-game.ts:114 | 每帧 ~1200 次字符串比较消除 | none |
| K4-08 | 5 处散点值与既有 token 撞值 → 替换 | storage/title/win | 缩放一致性；逐处 1 行 | none |
| K4-09 | --hud-h 定义在 hud :host，与 AGENTS.md「:root token」契约不符 | hud.ts:108 | 契约对齐；计算值不变 | none |
| K8-05 | 6 处散点 rem 与补位 token 重复 | title-screen:287 等 | 同上 | none |
| K7-03 | refineBetter 与 better 同构副本 → 删除 | solve-refine.ts | 排序策略单点 | none |

### Consider（有收益，有取舍）

| ID | 标题 | 定量收益 | 取舍/风险 |
|---|---|---|---|
| K3-05 | 太阳光晕并入背景烘焙 | 每帧省 120 顶点上传 + ~56% 屏占比混合填充（弱机 0.3-1ms/帧） | 需人工视觉验收 |
| K7-04 | GA 精英跨代复用指标 | ~20% 求解墙钟空转 | 依赖 golden 确定性（已成立） |
| K8-01 | 玻璃面 border/shadow 档位 token 化（12 处、shadow 8 档） | ~100 行收敛 | 档位映射需视觉确认 |
| K8-03 | grid 索引助手单源（含 render 视口范围） | 5→1 | 权重算术原地不动保位级 |
| K1-03 | 无潮汐时 setAmbient 缓存跳过 | 2 次跨界/tick | 幂等零影响 |
| K3-01 | 视域剔除恒空转（无相机）→ 简化或注释 | ~15 行死重 + 心智澄清 | 若未来加相机则保留 |
| K2-05 / K5-02 / K8-08 | sampleWind 返回值与 render 场景字面量 out 参数化 | 全仓仅存的每帧 2 分配归零 | 10 行机械改动 |
| K4-10 | 图标尺寸 token（--icon-sm/md/lg/xl） | 6 处 4 值 | 纯样式 |
| K6-04 | bakeSdf 接受预编译函数（编译 4→1） | µs 级，纯 DRY | 无 |
| K2-06 | Trail 顺序批量读出（免 1800 次取模/帧） | ~2µs/帧 + API 内聚 | 无 |
| K2-03 | cellAnchor 逆变换单源（bake×2 + surfaceY） | 一致收益 | 无 |
| K2-08 | sdf arity 校验编译期静态化 | 每关加载 ~0.2-0.5ms | 错误时机前移需同消息 |
| K4-05 | bestGrade 纯函数提取（30/60 阈值单源可测） | 可测性 | 无 |
| K4-06 | willUpdate 合并 + hasSfHistory 提取 | 双份守卫合一 | 无 |
| K5-03 | 风声带通频率与增益同平滑（zipper） | 音质顺滑 | 需真机试听 |
| K7-05 | 求解器 engine/terrain 缓存复用（两烘焙入口合一） | 每次评估省 wasm 实例+烘焙 | 顺序执行前提 |
| K7-06 | perf 记录块环形化 | dev 会话卫生 | 生产零成本 |
| K7-07 | watcher 补 add/unlink 事件 | dev 不跑陈旧 wasm | 2 行 |
| K7-08 | known-urls.ts 登记进 README 或删除 | 死脚本清单收敛 | 二选一 |
| K8-06 | --paper/--bg-top token（#fdf7ec/#fff8ea 散点） | 3 处可 token 化 | meta/manifest 保持字面量 |
| K8-07 | buttonKind 迁至 core（无 DOM 边界唯一越界） | 架构契约对齐 | 纯搬迁 |
| K8-09 | wasm preload 注入 + 可选 SW | 弱网省 1 RTT | SW 引入缓存失效面 |
| K6-06 | 进度 hash 改规范化 JSON | 格式化免疫 | **必须挂协议升级窗口**（存量记录作废一次） |
| K1-04 | init 死参数 heat_rate 移除 | ABI 收敛、消 10 vs 18 困惑 | 一次性 5 处同步 |

### Avoid（看似优化，实则陷阱——防未来误操作清单）

| ID | 陷阱 | 为什么不做 |
|---|---|---|
| K1-01 | 浮力循环跳过固体格 | 固体 v0 瞬态参与邻格平流是既有物理基线 → golden 全量漂移 |
| K2-04 | 潮汐相位增量累积 | ulp 累积经混沌放大 + 基线重录，收益纳秒级 |
| K2-09 | 源批量注入 | 浮点结合序变化 + ABI/canary 成本，收益 <1µs |
| K3-03 | 风扇相位累加 | 破坏 sim.time 单源 → pause/restart/倍速失步（玩家可见跳变） |
| K3-06 | 消除 subarray 视图（改整缓冲上传） | 上传带宽放大 10-20×，弱机劣化 |
| K3-08 | GL 状态去重 | attrib→buffer 绑定随切换失效 + restore 复位坑，双回归面 |
| K5-04 | base64 查表加速 | 冷路径 <1ms；查表映射错一位即坏内联关卡 |
| K5-05 | url-state dirty/removed 合并 | 空串 vs 删除语义耦合，破坏 C3/C9 |
| K6-05 | ?raw 显式 import 换 import.meta.glob | bundle 不变；字典序 level-10<level-2 陷阱 |
| K8-10 | FNV 双实现合并 | UTF-16 vs 字节口径不同 → 全部玩家进度作废 |
| K8-11 | wasm 32MB 缩减 | 未触碰页不占物理内存；min=max 下 GC 顶 = 局中硬崩 |
| K1-02 | （保持）512 页钉死 | 核算 ≈18.8MB 静态 + GC 余量合理；仅注释数字过时 |
| K4-07 | （防回归）onStatus 直推 + shouldUpdate 链路 | 已是最优形态，改即退步 |
| K2-07 | （保持）projectOut 128 迭代 | 交互路径 ≤20µs，收紧破坏吸附契约 |
| K2-06b | （保持）sdf 求值器位变微优化 | 增量坐标改舍入 → sdf-golden 漂移 |

## 3. 重点建议详述（Top 8）

### 1. K5-01 loop 让出批次逃逸 try/catch（唯一真实缺陷，建议立即修）
`loop.ts:88` 的 `setTimeout(() => this.runTicks(now), 0)` 在 frame 的 try/catch（54-62 行）栈外执行：16x 追赶帧（17-24 tick）时若 tick 在让出批次抛错，异常成为 uncaught → RAF 链不再续挂、running 保持 true、无"游戏循环异常"日志 → **画面永久静默冻结**。本会话已用真实 setTimeout 复刻验证；tests/loop.test.ts:16-19 的同步化 setTimeout 桩使该缺口不可见。
**改法**：抽 `fail(e)`（console.error + stop）供 frame catch 与 setTimeout 回调共用（~5 行）+ 补一条异步桩用例。

### 2. K3-05 太阳光晕并入背景烘焙（唯一有量级感知的性能项）
`drawSunHalo`（render.ts:266-268）完全静态（SUN_POS/SUN_RADIUS/SUN 全常量，无 sim.time 依赖），却每帧画 120 顶点的 seg=40 渐变圆盘，半径 12 世界单位 ≈ 典型地图 56% 屏占比做 SRC_ALPHA 混合填充——是动态趟单片元负载最大项。背景烘焙（FBO）已启用同程序同混合，光晕又是遮挡契约"最背景"层。
**改法**：bake 块内 drawSky 后加 drawSunHalo(bg)，删除每帧调用（1 行移动）。弱机（governor 降级对象）省 0.3-1ms/帧；需人工过一遍视觉。GL 层无 golden，靠同程序同混合保证等价。

### 3. K2-01 采样公式单源化（模块化最高优先）
`gx = wx/cell − 0.5 + origin` + `[0, n−1.001]` 钳位是"物理面≡碰撞面≡示踪采样≡等值线"的核心不变量，却手写 5 处（terrain.sample / bilinearSample / surfaceY / render 视口 / 两处 moon 镜像）。改口径漏一处即静默错位。
**改法**：新 `sim/grid.ts` 导出 worldToGrid/clampGrid，5 处 TS 消费方改调；运算顺序与钳位分支逐条保留（位级等价，parity 测试继续守护）；moon 侧注释互引。

### 4. K7-01/02/04 求解器三重浪费（~20% 墙钟空转 + 回归基线退化）
- pathLen 热循环累计但全仓零消费（本会话 grep 复核确认）——纯删。
- KNOWN_SOLUTIONS 的 time/groundTime/total 零消费，`--verify-known` 只确认"仍通关"不比对耗时——物理改动导致的参考解漂移不可见。**改法**：cmdVerifyKnown 补 total 比对（|Δ|>0.5s 打 ✗ 提示人工确认回填，只打印不写文件）。
- GA 每代对 4 个精英个体全量重评（确定性下指标必不变）≈ 20% 墙钟空转；refine 侧已有 srcKeySorted memo 先例。**改法**：精英带指标跨代，每代只评 28 个新个体。

### 5. K4-03/K4-01/K8-02/K8-04 样式样板收敛（~200 行重复）
15 个 SVG 图标重复公共属性样板（工厂化省 ~100 行）；玻璃胶囊配方 5 处手写、4 档透明度漂移；胶囊链接钮双份逐行复制（about-card 注释自认"同配方"）；button 重置 3 份且 :active 缩放已漂移（0.97 vs 0.95）。全部数值原样保留 = 零视觉变化。

### 6. K8-01 玻璃面档位漂移（样式统一最大面）
--blur-glass/--card-glass 已 token 化，但 border alpha 4 档（0.45-0.7）、box-shadow alpha 8 档（0.06-0.22）散在 12 处——结算卡阴影比主页卡暗 3 倍无层次理由。
**改法**：:root 增 --glass-line + 3 档阴影 token（ctl/card/overlay），12 站点映射最近档位。

### 7. K6-01/02/03 状态层冷路径整洁
resolveLevel({json}) 每次派生重复全量校验+全域烘焙（1-3ms）且身份抖动导致 keyed 误重建——单槽缓存即消；内置关卡 hash 标题页每渲染 40 次全文 FNV——预计算一次；LevelDef 手工重复 LevelJson 全部字段——Omit 单源派生。

### 8. K1-05/06 内核门面 ABI 单源
margin→格数换算双实现（terrainDims.origin vs WasmFluid.marginCells）仅靠输入恒等维持一致；顶点 stride 6 双份且无 canary（tracer stride 已导出是现成先例）。都是"改了只记得改一处"的漂移面。

## 4. 分模块健康度

- **内核与门面（K1）**：性能工程标杆——air 表+bulk 快路径+红黑 GS 位精确 SIMD、零拷贝采样、跨界收敛到最小集；剩余项全部是 ABI 单源化，无热路径改动。
- **模拟与数值（K2）**：四个热点零分配、罚时/拖尾/常量单源到位；主要收益是公式单源化（5 处采样公式、marginCells、GROUNDED_ALT）。
- **渲染（K3）**：热路径零分配、STATIC_DRAW 分层、遮挡契约两趟结构清晰；唯一量级项是静态光晕入背景烘焙；视域剔除当前恒空转属"未来相机假设"的诚实遗产。
- **UI（K4）**：事件流与短路链路已是教科书形态（防回归条目）；收益集中在样式样板收敛与 levelNo 缓存。
- **核心（K5）**：一个真实缺陷（loop 逃逸）+ 音色平滑 + 零分配注释一致性；base64/url-state 经实测为最小正确形态。
- **状态与关卡（K6）**：冷路径、防御完备、逐关容错不变量正确；收益是缓存与类型单源。
- **工具链（K7）**：worker 池/确定性依赖/build 取舍全部正确；死代码与重评浪费是主要面。
- **跨模块与资产（K8）**：bundle 精简（186KB/gz 58KB）、内存核算健康、测试 2.4s 高效；样式档位漂移与 token 残余是主要面。

## 5. 红线合规声明

- **正确性第一**：全部 adopt/consider 项均为位级等价重构或纯结构改动；无一条触碰 engine-golden/sdf-golden/canary/确定性物理。唯一例外 K6-06（进度 hash 规范化）明确标注"挂在协议升级窗口、存量记录作废一次、release notes 明示"，且判为 consider。
- **玩家体验第一**：陷阱清单中 K3-03（风扇相位）、K8-10（FNV 合并）、K3-08（GL 去重）正是为防玩家可见回归而立；K3-05 需视觉验收后才落地。
- **物理真实第一**：K1-01（浮力固体格）、K2-04（潮汐增量）、K2-09（源批量）三条"性能直觉"均因会改变物理时间序列或浮点结合序而被判 avoid。

## 6. 落地建议（执行批次）

- **第一批（立即，零风险）**：K5-01（真实缺陷）→ K7-01/02/03（求解器死代码）→ K4-04/08/09、K8-05（一行级 token/缓存）→ K6-01/02/03（缓存与类型单源）→ K3-02/09、K1-05/06（结构拆分与 ABI 单源）。
- **第二批（视觉验收后）**：K3-05（光晕入背景）→ K4-01/03、K8-02/04（样式共享块）→ K8-01（玻璃档位）→ K7-04（GA 精英复用）。
- **第三批（择机）**：K2-01、K8-03（公式单源）→ K2-05/K5-02/K8-08（每帧分配归零）→ K5-03（音色平滑，真机试听）→ K8-09（preload/SW）→ K6-06（协议升级窗口）。
- **不执行**：avoid 清单 15 条——已在代码现状中论证为正确形态。

---

## 7. 执行记录（2026-08，已全部落地并验证）

> 最终基线：`bun run check` 全链通过 · typecheck 零错误 · vitest **28 文件 121 用例**（+1 新增）· moon 测试 15/15 · **engine-golden/sdf-golden 哈希与基线一致（零数值漂移）** · bundle 186.15KB → 184.46KB。

### 已执行（42 项）

**第一批（立即）**：K5-01（loop 让出批次共用 fail 停机路径 + 异步桩回归测试）、K7-01（pathLen 死计算删除）、K7-02（--verify-known 补总耗时比对，实测 luo-yu 21.9s 与登记一致）、K7-03（refineBetter 删除改复用 better）、K4-04（levelNo/name 缓存至 willUpdate）、K4-08/K4-09/K8-05（散点 token 替换、--hud-h 移 :root）、K6-01（resolveLevel 单槽缓存）、K6-02（内置 hash 预计算 Map）、K6-03（LevelDef Omit 单源）、K3-02（draw 拆 drawBackground/drawTerrainPass）、K3-09（SUN_POS 元组）、K1-05（marginCells 单源）、K1-06（bVertexStride 内核导出 + canary）。

**第二批**：K3-05（太阳光晕并入背景烘焙——同程序同混合等价，**需真机视觉验收**）、K4-01（glassChip 共享块）、~~K4-03（icons 工厂化 194→125 行）~~ **修复后重新落地**：初版工厂的嵌套 `html` 模板把 svg 子内容经普通 `<template>`（HTML 上下文）解析成 HTML 命名空间元素，SVG 渲染器拒绝绘制（全端图标空白；DevTools 编辑 html 强制重解析即恢复）。修复 = 内层改用 lit 的 **`svg` tag**（解析时以 `<svg>` 包装再解包，子元素落 SVG 命名空间），外层保留 `html` 全量 svg 字面量，`stroke-linejoin` 用标准条件绑定。CDP 双判据实证：badNamespaces=[]、像素 dark=65（与原始硬编码版逐像素一致）。K8-02（pillLink 共享块）、K8-04（buttonReset 共享块）、K8-01（--glass-line + 三档阴影 token）、K7-04（GA 精英 memo 跨代复用）。

**第三批（可无外部输入项）**：K2-01（sim/grid.ts 单源：terrain.sample/bilinearSample/surfaceY 三处收敛，位级等价）、K2-02（marginCells）、K2-03（cellAnchor 逆变换单源）、K2-05/K5-02（sampleWind out 参数化）、K2-06（Trail.forEachPoint 批量遍历）、K2-08（FIXED_ARITY 编译期校验，每格 expectArgs 移除）、K2-10（GROUNDED_ALT 具名）、K8-03（render 视口 worldToGrid）、K8-06（--paper/--bg-top token）、K8-07（buttonKind 迁 core/input-kind.ts）、K8-08（render 场景复用对象 + windSample 复用——每帧分配归零）、K4-05（bestGrade 纯函数）、K4-06（willUpdate 合并 + hasSfHistory 单点）、K4-10（--icon-sm/md/lg/xl）、K6-04（bakeSdf 预编译参数，编译 4→1）、K7-05（求解器引擎实例复用：worker 一个 + 主进程一个，确定性实测不变）、K7-07（watcher 补 add/unlink）、K7-08（known-urls 登记进 README）、K1-03（setAmbient 三元组缓存跳过）。

### 收尾批次（全部落地）

- **K1-04**：init 死参数 heat_rate 全链移除（moon ABI + engine.ts + FluidConfig + 全部调用点/wbtest），js 步进改用 simulation 模块常量 HEAT_RATE。moon 15/15、vitest 121/121、golden 零漂移。
- **K5-03**：WindVoice 带通频率与增益同 tau 平滑（消除 ≤60Hz 档 16ms 阶梯扫频），纯音频路径。
- **K8-09**（preload 部分）：index.html 静态声明 `<link rel="preload" href="./app/wasm/sfengine.wasm" as="fetch" crossorigin>`，vite 构建自动重写为 hash 资产名（实测 `./assets/sfengine-DknpbZbj.wasm`，且与 `?url` 导入去重为单一资产）——零插件、零稳定文件名；Service Worker 仍待产品决策。
- **K6-06**：关卡内容 hash 口径改 JSON 规范化文本（parse→stringify，空白/格式不敏感）；存量记录作废一次已按用户确认接受，口径注释明示"除非协议升级不得再改"。
- **K7-06**：按二次评估永久搁置（生产路径 devTools 恒 null 零成本，收益≈0）。

### 关键验证事实

- **位级等价证明**：grid.ts/cellAnchor/marginCells/bakeSdf 重构后，engine-golden 四场景哈希、sdf-golden 64+近场逐位断言、canary、margin>0 parity 全部原样通过。
- **确定性证明**：求解器引擎复用后 `--verify-known` 实测 luo-yu 总耗时 21.9s 与登记基线逐位一致。
- **K5-01 实测修复**：异步桩回归测试（第 17 个 tick 抛错 → fail 停机 + 日志 + RAF 链停），修复前该路径为 uncaught 静默冻结。
- **新增文件**：app/sim/grid.ts、app/core/input-kind.ts；无删除。
