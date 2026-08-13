# 烧风 sfgame-web 全仓库代码评审报告

> 范围：/Users/sf/dev/scnucj2026（159 个跟踪文件、约 2.6 万行）· 基线 b2b809d（0.7.0）
> 方法：10 个模块评审代理全量深读 → 对抗式交叉验证 → 定点复查 → 本会话实测复核

## 1. 执行摘要

烧风（sfgame-web）是 Lit 3 + WebGL 物理益智游戏：放置热/冷源造风让纸飞机抵达目标。数值内核（流体/顶点批/示踪）以 Moonbit 编译为单个 WASM 模块（单内存 min=max 钉死、零 import），宿主 TS 分层（core/game/sim 无 DOM 可无头测试；ui/dev 为 DOM 层；render 为 WebGL 层）。20 个关卡、26 个测试文件、无 CI，Cloudflare 纯静态部署。

**总体质量判断：架构纪律极强、坑位落地率高，但存在一个高危可用性攻击面、多条"功能存在但不生效"的实现短路、以及契约文档漂移。** 位稳定性（f32 存储/f64 中间量 + golden hash）、ABI 分层防御（零 import → min=max 内存 → canary 双向握手 → golden hash）、单一事实源（terrain 烘焙场、拖尾淡出常数、罚时常数、URL schema）执行到位并被测试钉死。两轮评审共 59 条原始发现，主题去重后约 51 条：高危 1、中危 7、低危 39、信息 4。其中 8 条经独立对抗验证/实测：**6 条确认（2 条在验证中加重）、1 条修正降级、2 条驳倒**——25% 驳倒率证明验证环节必要。

**最严重的 5 个风险**：

1. **R3-01 恶意内联关卡 URL 可冻结任意玩家标签页**（高×高，已确认并加重）：网格越界 world 只报错不短路，攻击者控制的 w/h 驱动 w×h 次 SDF 采样；w/h ≥ 2⁵³ 时浮点步进失效、死循环永不终止。
2. **R4-01 渲染地形相对物理面恒偏半格**（中×高，已确认）：marching squares 用角点格读数、SDF 场按格心烘焙，每关每帧可见错位（cell=0.75 时 0.375 世界单位）。
3. **R8-01 check/test 命令契约全面漂移 + 无 CI**（中×高，已确认）：类型检查实际未被任何门禁执行；fresh clone 按文档跑测试必挂。
4. **R6-01 governor 自适应降级整链失效**（中×高，已确认并加重）：降级唯一出口被尺寸守卫短路，且 governor 随关卡重建每关归零。
5. **R2-01 SDF 求值链无 NaN 守卫**（中×低，已实证复现）：畸形表达式经 surfaceY 目标锚点瞬时通关并写入假纪录。

---

## 2. 风险总览

风险分数 = 严重度权重 × 可能性权重（严重度：高 4 / 中 2 / 低 1 / 信息 0.3；可能性：高 3 / 中 2 / 低 1）。

**严重度 × 可能性矩阵（验证后，约 51 条）**

| 严重度 \ 可能性 | 高 | 中 | 低 | 小计 |
|---|---|---|---|---|
| **高** | 1 | 0 | 0 | 1 |
| **中** | 3 | 3 | 1 | 7 |
| **低** | 8 | 8 | 23 | 39 |
| **信息** | 0 | 0 | 4 | 4 |
| **小计** | 12 | 11 | 28 | 51 |

置信度：已确认约 40 条、很可能约 8 条、推测 1 条。高危面窄而真实：唯一高危是分享链接触发的可用性攻击面；中危集中在"渲染错位 / 命令契约 / 性能治理 / 状态机与音频反馈失效 / 数值守卫缺失"。

---

## 3. 按优先级排序的核心发现（Top 15）

### 1. 恶意内联关卡 URL 触发无界地形采样冻结页面（R3-01）【严重度:高 | 可能性:高 | 置信:已确认 ✓验证加重】
- **位置**：`sfgame-web/app/game/level-validate.ts:119-126`（另见 147、155-156）
- **问题**：`checkWorld` 在流体网格越界（nx>256 等）时只 push 错误仍返回攻击者控制的 `{w,h}`；`validateLevelJson` 随后以该 w/h 调 `checkTerrain → sampleTerrain`，后者对 `y=0.5..h、x=0.5..w` 逐点求值 SDF——循环次数完全由 URL 里的 `world.w/h` 决定。内联关卡经 `?lv=<base64>` 在页面加载主线程同步执行，全程无长度上限守卫。
- **证据**：`checkWorld` 越界分支只 `ctx.errs.push(...)` 后 `return { w: wv, h: hv }`；`sampleTerrain` 双层循环 `for (let y = 0.5; y < h; y += 1) { for (let x = 0.5; x < w; x += 1) ... }`。评审实测 w=h=2000 时网格报错仍执行 4e6 次采样（37ms）；w=h=1e5 冻结约 90 秒。**验证加重**：w/h ≥ 2⁵³ 时浮点 `y += 1` 失效，循环永不终止（纯 CPU 死转），浏览器"页面无响应"对话框是唯一缓解。
- **影响**：任意人可构造一条内联关卡分享链接（核心分享功能，非边角路径），受害者打开即标签页冻结数分钟至死循环。设计注释（"world 非法时动态边界自动失效"）与 schema 描述（"极端尺寸由关卡校验精确拦截"）均表明越界应短路或夹紧，实现与意图相悖。
- **修复**：`checkWorld` 网格越界时直接 `return null`（使 checkTerrain 的 wMax/hMax 为 undefined 而跳过采样）；同时在 `lvCodec.decode`/`screenFromUrl` 层加 w/h 上限守卫作纵深防御。

### 2. 地形 marching squares 用角点格读数，渲染地形相对物理面恒偏半格（R4-01）【严重度:中 | 可能性:高 | 置信:已确认 ✓验证量化】
- **位置**：`sfgame-web/app/render/render.ts:244-254`（对照 `app/game/sdf.ts:287-297`、`app/sim/terrain.ts:104-109`、`moon/batch.mbt:668`）
- **问题**：`setupTerrain` 把 x0/y0 设为 `-originX·cell`，内核 `b_terrain_draw` 将 `field[i,j]` 当作格点 `(i-origin)·cell` 处的值（角点约定）；但场的生产路径 `bakeSdf`/`bakeTerrain` 都在格心 `(i-origin+0.5)·cell` 采样。其余全部消费方（流体采样、terrain.sample、tracers sdf_at）都用格心约定，唯独 marching squares 用角点约定。
- **证据**：render.ts:246 `-t.originX * t.cell` vs sdf.ts:291 `wy = (j - origin + 0.5) * cell`；batch.mbt:668 `y0 = tg_y0 + j·cell`（角点）；tests/batch.test.ts 手工设场值、不经过 bake，测不出错位。**验证量化**：整幅等值线统一平移 −0.5·cell 双轴；cell=0.75 时 0.375 世界单位 ≈ 机身长（3.2）的 12%，静息飞机/放源吸附点可见地"沉入"地面。
- **影响**：每关每帧可见的视觉-物理错位，违反"渲染与碰撞采样同一份场"的单一事实源契约。纯视觉，不改物理与 golden hash。
- **修复**：render.ts 的 x0/y0 各 `+0.5·cell`（或内核锚点补半格）；在 batch.test.ts 补一条走真实 bake 坐标的对齐断言。

### 3. check/test 脚本与契约文档全面漂移：check 无 typecheck、test 无 build:wasm、根目录无脚本（R8-01）【严重度:中 | 可能性:高 | 置信:已确认 ✓验证加重】
- **位置**：`sfgame-web/package.json:15-20`；根 `package.json:8-12`；`AGENTS.md:19`；`sfgame-web/README.md:11`
- **问题**：文档声称 `bun run check` = typecheck → test → build（fail-fast）、`bun run test` = build:wasm + test:moon + vitest。实际：根 package.json 只有 build/dev/deploy（根目录跑 check/test 直接 "Script not found"）；sfgame-web 的 check = `bun run build && bun run test`（无 typecheck）；test = `bun test:moon && vitest run`（无 build:wasm）。typecheck 脚本存在但从未被任何链引用。**验证加重**：fresh clone 下 vitest 在 setup 阶段以裸 ENOENT 失败（wasm 产物 gitignored），并非文档所称的友好提示。
- **影响**：仓库无 CI，类型错误可静默通过唯一验证门（vite build 走 esbuild 转译不做类型检查）；新贡献者按文档操作必失败；命令契约整体失真。
- **修复**：根 package.json 透传 check/test；sfgame-web check 改 `typecheck && test && build`；test 前置 `build:wasm`；同步修正 AGENTS.md/README 三处描述。

### 4. governor 的 dpr 降级被 fit() 尺寸守卫短路，自适应降级整链失效（R6-01）【严重度:中 | 可能性:高 | 置信:已确认 ✓验证加重】
- **位置**：`sfgame-web/app/ui/controller.ts:185-199, 302`（配合 `app/render/render.ts:141-149`、`app/core/governor.ts:41-44`）
- **问题**：`if (this.governor.record(cost, this.rate)) this.fit()` 是降级唯一出口；但 fit() 开头 `if (w === this.fitW && h === this.fitH) return` 在宿主尺寸未变时直接返回，而 `renderer.resize()`（全仓唯一写 canvas.width/height 的路径）只在此函数内调用。governor 升档（tier 0→1）时 w/h 必然未变 → resize 永不执行 → 帧缓冲仍按旧 pixelRatio 创建。**验证加重**：governor 在 controller 构造时新建，而 controller 随 `keyed(activeLevel)` 每关重建——tier 每关重置为 0，降级在任何可达路径上都不会真正生效。
- **影响**：弱 GPU（iOS Metal/低端安卓）持续慢帧时唯一降级杠杆完全失效，游戏保持满分辨率持续掉帧；dev 面板显示的 dpr 与真实分辨率不一致，误导调试。
- **修复**：降级路径强制 resize（绕过尺寸守卫），或 governor 提升到跨关卡生命周期。

### 5. SDF 求值/烘焙链无 NaN/Inf 守卫：畸形表达式可瞬时通关并写入假纪录（R2-01）【严重度:中 | 可能性:低 | 置信:已确认 ✓实证复现】
- **位置**：`sfgame-web/app/game/sdf.ts:69, 262`（下游 `simulation.ts:259-275`、`terrain.ts:54`、`level-validate.ts:151`）
- **问题**：`sqrt` 无定义域检查、除法无除数检查可产出 NaN/±Inf；`bakeSdf` 直写 Float32Array 无有限性检查；`terrainFromField` 的 `field[idx] <= 0` 对 NaN 恒 false → NaN 格被静默判空气。下游 `checkGoals` 的 `Math.sqrt(dx*dx+dy*dy) >= g.r` 对 NaN 恒 false → 目标被判 visited → 一步内 `phase='won'`。level-validate 只在世界内部以 1.0 步长抽查，窄 NaN 区间与地图外 margin 带可绕过。仓库自身标准是"发散即抛错"（solve-lib.ts:71 有守卫），游戏路径缺失同款守卫。**验证机制修正**：NaN 主入口是 surfaceY 推导的目标锚点（内置关卡 goal 均无显式 y），而非飞机坐标本身；实证两例（margin 带 NaN 行、0.2 宽 NaN 圆盘）均 0 校验错误、1 步通关。
- **影响**：畸形 SDF（dev 编辑器直接可制造，玩家内联关卡可分享）瞬时通关并污染进度数据；NaN 同时污染渲染顶点。
- **修复**：bakeSdf 后全场扫 Number.isFinite，非有限即抛错；checkGoals 对距离加 isFinite 守卫，NaN 按失败处理。

### 6. won 后经 URL 撤销/重做永久失去再通关能力：phase 重置但 visited 未清（G2-02）【严重度:中 | 可能性:中 | 置信:已确认】
- **位置**：`sfgame-web/app/ui/controller.ts:221-227`（配合 `simulation.ts:148, 259-275`）
- **问题**：通关后按撤销/后退（popstate 改 s），`applySources` 把 `phase` 拨回 'playing'，注释声称"下一帧会重新判定"——但 `checkGoals` 的 `if (this.visited[i]) continue` 使已通关的 visited 恒 true，`phase='won'` 永远不再触发；visited 只在 restart() 清零。
- **影响**：无声状态机损坏：通关后任何一步撤销/重做即进入"看似可玩但永不能赢"的僵尸局，只能重置自愈。
- **修复**：phase 重置路径同步清 visited/visitedCount；或仍满足胜利条件时保持 won。

### 7. BGM 音量只在元素创建时设定一次：以静音态进游戏后解除静音，BGM 永久无声（G3-01）【严重度:中 | 可能性:中 | 置信:已确认】
- **位置**：`sfgame-web/app/core/bgm.ts:29, 46-49, 60-65`（配合 `feedback.ts:8, 30-35`）
- **问题**：`el.volume = this.muted ? 0 : BGM_VOLUME` 只在首次手势创建 Audio 元素时执行；`setMuted(false)` 只 play() 从不写回 volume。上次会话静音持久化 → 本次创建时 volume=0 → 玩家解除静音后 BGM 以 0 音量播放直到刷新。
- **修复**：setMuted 内同步写回 volume（或 attempt() play 前按 muted 设定）。

### 8. AudioContext 恢复只认 suspended，iOS 的 interrupted 态被漏过（G3-03）【严重度:中 | 可能性:中 | 置信:很可能】
- **位置**：`sfgame-web/app/core/sfx.ts:141-145, 153`
- **问题**：两处恢复点（visibilitychange、手势 unlock）都只对 `state === 'suspended'` 调 resume。iOS 来电/系统占用后 WebAudio 会停留 'interrupted' 且前台返回不自动恢复，音效从打断起静默到刷新。
- **修复**：判定改 `state !== 'closed' && state !== 'running'` 即 resume。

### 9. 落地判定阈值与物理尺度不匹配：落地音/震动几乎从不触发（R6-03）【严重度:低 | 可能性:高 | 置信:已确认】
- **位置**：`sfgame-web/app/core/wind.ts:35-40`（配合 `bodies.ts:18-22`）
- **问题**：isLanding 要求单 tick 内高度下降 ≥0.35（|vy|≥21 u/s），而物理标定下静风终端速度收敛于 1 u/s；数值验证：静风坠落 max|vy|=1.0 触发 0 次，-9 u/s 强下沉气流仅 ≈5.8 u/s 仍不触发。
- **影响**：玩家正常降落永远无声无震，按撞击速度调响度的设计失效。
- **修复**：改多 tick 宽容窗/空中→贴地边沿检测，按物理尺度重标阈值。

### 10. 样式 token 化契约系统性偏离：12+ 处散点 rem 间距/控件尺寸（R5-03）【严重度:低 | 可能性:高 | 置信:已确认】
- **位置**：`hud.ts:110,177`；`title-screen.ts:253,287,427`；`storage-view.ts:214,229,278`；`win-overlay.ts:155,165,176`；`about-card.ts:68,159`；`status-bar.ts:103`；`sf-game.ts:145-146`；`shared-styles.ts:134`
- **问题**：`--hud-pad:0.5625rem`、`gap:0.375rem`、`padding:0.6875rem 1.375rem` 等散点值遍布，违反"间距/圆角/控件尺寸一律用 :root token、禁止新散点值"。另有 pageShell .icon-btn 用 display:grid + place-items:center（固定方形钮内无溢出风险，属字面违规）。
- **修复**：收敛进 --sp-N 或新增命名 token；place-items 处改 margin:auto 或注释豁免。

### 11. dev 模式对生产玩家无凭据可达：三路激活 + dev 代码全量进生产 bundle（R7-01）【严重度:低 | 可能性:高 | 置信:已确认】
- **位置**：`sfgame-web/app/ui/app.ts:48-51, 79, 282-283, 312-318`（另见 `screen.ts:15-20`、`title-screen.ts:24-29`、`vite.config.ts:18-23`）
- **问题**：① `?dev=1` 无构建环境门槛；② `?v=dev` 无需 dev 标志即进开发者页面，页内开关一键开启；③ 关于按钮长按 500ms 隐藏入口同样生效。dev 代码静态 import、codeSplitting:false 单 bundle、全仓无 import.meta.env 门槛，全部进生产包。激活后可全关卡解锁、源无限、16× 速率、关卡编辑覆写；且 dev 模式通关仍上报 GA，分析数据可被污染。
- **修复**：构建环境门禁 dev 模块；或在 analytics 层过滤 dev 会话；若维持隐藏入口设计，在文档明示为公开特性。

### 12. status-bar levelId 声明为 Number 却收到 slug 字符串，「第 N 关」标签永不渲染（G2-01）【严重度:低 | 可能性:高 | 置信:已确认】
- **位置**：`sfgame-web/app/ui/status-bar.ts:8, 18`（绑定在 `sf-game.ts:108`）
- **问题**：sf-game 传 `level.id`（slug，如 "luo-yu"），status-bar 声明 `@property({ type: Number })`，`'luo-yu' > 0`/`NaN > 0` 恒 false → 序号恒空串，与 title-screen 的「第 01 关」不一致；若内联关卡 id 恰为纯数字串又会错误显示。
- **修复**：绑定侧传入真实序号（LEVELS.findIndex+1），属性保持 Number；或改 string 型并在 app 侧算好。

### 13. level_start 只在按钮式进关上报：直达/后退会话的 GA 漏斗出现孤儿完成（G3-02）【严重度:低 | 可能性:高 | 置信:已确认】
- **位置**：`sfgame-web/app/ui/app.ts:157-162, 85-87, 126-127, 261-262, 274-284`
- **问题**：level_start 唯一触发点是 enterLevel()；URL 直达与 popstate 进关不发 start，但这些会话通关照发 level_complete → GA 里 completion > start、转化率分母缺失。分享链接是一等使用路径。
- **修复**：level_start 上报点移到"进入 game 屏且关卡变化"的公共路径，按钮路径改走同一公共点并去重。

### 14. level-editor 违反 A2 box-sizing 契约：.toggle 吞掉面板内边距（R7-03）【严重度:低 | 可能性:高 | 置信:已确认】
- **位置**：`sfgame-web/app/dev/level-editor.ts:15-45`
- **问题**：组件无 `box-sizing: border-box` 自声明；`.toggle` 的 `width:100% + padding` 在 content-box 下 border-box = 内容宽 + 2×--sp-2，按钮压到面板边框。
- **修复**：static styles 开头加 boxReset 规则。

### 15. 契约文档漂移三连：cloudflare/AGENTS.md 未裁剪模板、docs/development.md 悬空引用（R8-04/R8-05）【严重度:低 | 可能性:高 | 置信:已确认】
- **位置**：`cloudflare/AGENTS.md:1-41`；`AGENTS.md:13`；`sfgame-web/README.md:66`
- **问题**：cloudflare/AGENTS.md 是官方脚手架泛化模板（指示 wrangler types、罗列 KV/R2/D1 等一概未用的服务），实际是纯静态 assets 部署、无 worker 代码无绑定；AGENTS.md 与 README 引用的 `docs/development.md` 在仓库中不存在（docs/ 目录整体缺失）。
- **修复**：裁剪 cloudflare/AGENTS.md 为实际部署说明；补齐或删除 docs/development.md 引用（推荐删除并入 AGENTS.md，避免第三份来源漂移）。

---

## 4. 交叉验证结果（8 条）

| 编号 | 结论 | 关键修正/加重 |
|---|---|---|
| R3-01 | ✅ 确认（加重） | w/h ≥ 2⁵³ 时死循环永不终止（非"数小时量级"）；影响面限于单标签页可用性 |
| R4-01 | ✅ 确认（量化） | 整幅等值线精确平移 −0.5·cell；cell=0.75 → 0.375 u ≈ 机身 12%，可见 |
| R8-01 | ✅ 确认（加重） | fresh clone `bun run test` 在 setup 阶段裸 ENOENT，非文档所称友好提示 |
| R6-01 | ✅ 确认（加重） | governor 随 keyed(activeLevel) 每关重建、tier 归零，任何路径都不生效 |
| R2-01 | ✅ 确认（机制修正） | NaN 主入口是 surfaceY 目标锚点而非飞机坐标；实证两例 0 错误、1 步通关 |
| R8-02 | ⚠️ 修正降级（中→低） | 机制修正：bun 下未处理 rejection 直接崩溃 dev 进程，非"永久卡死"；仅 DX 问题 |
| R1-01 | ❌ 驳倒（中→低） | 满容量静态缓冲（40960 格）吸收越界写 + 原评审两处算术错误 + 游戏路径不可达；残余为纵深 guard 建议 |
| G4-01 | ❌ 驳倒（本会话实测） | `bunx vitest run tests/level4.test.ts` 实际通过（823ms）；残留低危：断言取在正弦过零点（1 ulp 余量）、语义与"半周期后反向"不符，建议改断言 t=3·period/4 |

**验证教训**：8 条中 2 条被驳倒、1 条降级——评审代理的"confirmed + 实测值"仍可能含复刻误差；关键结论必须回仓库执行复核。

---

## 5. 模块健康度

- **WASM 内核与 ABI（R1）**：极高纪律。零 import、min=max 内存钉死、canary 双向握手、golden hash、wbtest 常量对齐构成完整分层防御；init guard 缺 margin/cell 校验属纵深建议（无可达路径），moon 头注释引用已删除的对拍文件。
- **模拟与数值（R2）**：单一事实源执行到位（terrain 烘焙场、拖尾常数、罚时同源）；SDF NaN 链是唯一大洞；trail 环形容量在高速段偏离"随时间淡出"契约；求解器通关时刻与真机差 ≤1 帧。
- **游戏状态与关卡（R3）**：校验体系完整、hash 绑定与解析容错到位；checkWorld 不短路造成攻击面；progress 负值毒化、hash 空白敏感。
- **渲染（R4）**：遮挡契约与零拷贝纪律好；半格错位是全场最可见缺陷；drawBatch 缺守卫、示踪记录 np 零余量跨文件耦合、tKey 每帧分配。
- **UI（R5）**：样式契约执行率高、事件链清晰；存在死功能（status-bar 序号）与状态机断点（撤销后不能通关）、undo/redo 缺 sf 守卫、status-bar 缺 boxReset。
- **核心循环与反馈（R6）**：纯逻辑可测性最好；但三条反馈链实际不工作——governor 降级、落地反馈、BGM 静音恢复/audio 中断恢复。
- **开发者工具（R7）**：功能齐全；边界模糊（生产可达、无凭据、分析数据可污染）、box-sizing 违约、滚动 touch-action 收敛问题。
- **构建管线与脚本（R8）**：构建链本身完整（bun 门面、wasm-rebuild、求解器罚时同源）；文档契约漂移严重（check/test 描述、cloudflare 模板、docs 悬空）、source maps 旗标隐患、moon 缺失时错误处理差。
- **测试套件（R9）**：体系强（golden/canary/对拍/最小集教义）；盲区：canary 只钉常量镜像不验执行侧守卫、SDF golden 采样域远场化、tracers 边界零覆盖、margin>0 对拍缺失；潮汐断言语义脆弱（实测通过）。
- **端到端链路与契约一致性（R10）**：AGENTS.md 高质量但漂移累积（docs 缺失、check 描述、SKILL.md 关卡数未更新至 20 关、known-solutions 缺 gui-xu 基线）；挂机不变量自 #18 起无自动回归是渐进风险敞口。

---

## 6. 修复路线图

**P0 · 上线前必改**
1. R3-01：checkWorld 越界 return null + decode 层上限（一行级修复，封死攻击面）
2. R8-01：check/test 脚本链修正（typecheck 纳入 check；test 前置 build:wasm；根目录透传）+ 文档同步
3. R4-01：渲染锚点补半格 + bake 对齐测试
4. R2-01：bakeSdf 有限性守卫 + checkGoals NaN 不判胜
5. G2-02：phase 重置时清 visited
6. G3-01：setMuted 写回 volume
7. G3-03：resume 判定改非 running（覆盖 interrupted）

**P1 · 下个迭代**
8. R6-01：降级路径强制 resize + governor 跨关生命周期
9. R6-03：落地判定改宽容窗/边沿检测 + 阈值重标
10. R7-01：dev 门禁（构建环境开关）或明示为公开特性 + dev 会话分析过滤
11. G2-01：status-bar 序号修正；G3-02：level_start 上报点移到公共进关路径
12. R8-02：spawn 包 try/catch + finally 复位 compiling
13. R1-01 残余：内核 guard 补 margin/cell 校验（纵深防御）
14. G4-01：潮汐断言改反向点（当前通过，属语义加固）

**P2 · 择机**
样式 token 收敛、box-sizing 补齐（R7-03/R5-01）、cloudflare/AGENTS.md 裁剪、docs 引用清理、canary 负向用例（G4-03）、tracers 边界测试（G1-02/G1-03）、SDF golden 采样域扩充（G4-02）、margin>0 对拍（R1-04）、拖尾容量（R2-02）、progress 非负校验（R3-02）、undo/redo sf 守卫（G2-03）、source maps 旗标删除（R8-03）、SKILL.md 同步（R1-02/R10-03/R10-04）、批注释修正（R1-03/R4-04）等。

---

## 7. 附录：其余发现简表

| 编号 | 标题 | 位置 | 一句话 |
|---|---|---|---|
| R1-02 | pitfalls I8「终局」断言 GS SIMD 已全部移除，与现存 f64x2 gs_pair 矛盾 | skills/pitfalls/SKILL.md:462 | 坑手册自相矛盾，维护者可能误删 f64x2 白丢 ~29% 性能 |
| R1-03 | moon/*.mbt 头部注释引用已删除的对拍测试文件 | moon/ffi.mbt:4 | 指引失效，实际守护者是 engine-wasm/engine-golden |
| R1-04 | 生产采样路径（margin>0）缺位级对拍 | tests/fluid.test.ts:61-84 | 对拍硬编码 margin=0，生产 margin=10 只有静态论证 |
| R1-05 | 地形烘焙缓冲按 6 顶点/格定容，常规路径最坏 9 顶点/格 | moon/batch.mbt:671-672 | 极端地形静默截断（手工关卡极难触发） |
| R2-02 | 拖尾环形容量按路程截断高速段 | app/sim/trail.ts:58-71 | >7.5 u/s 持续段拖尾尾端提前消失，纯视觉 |
| R2-03 | 求解器通关时刻与真机差 ≤1 帧 | scripts/solve-lib.ts:66-79 | toFixed(1) 边界可能差 0.1s，对排序无影响 |
| R3-02 | parseEntry 接受负 time/extra，负条目永久毒化纪录 | app/game/progress.ts:32-40 | 手工篡改/旧版残留可使该关卡新纪录被永久拒绝 |
| R3-03 | 关卡 hash 空白敏感 | app/game/levels.ts:109-114 | 纯格式改动即令记录失效重锁（设计权衡，info） |
| R4-03 | 热路径每帧小分配 | app/render/render.ts:201 | tKey 模板串 + subarray 视图，量级极小 |
| R4-04 | batch.mbt 容量注释过时（info） | moon/batch.mbt:7 | 地形已迁出主批，实际最坏 ≈8 万顶点 |
| R4-05 | cloudBuf 硬编码 3 朵云无守卫（info，推测） | app/render/render.ts:118 | 未来提云数量即静默丢云，当前无故障 |
| R5-01 | status-bar 唯一缺 boxReset 组件 | app/ui/status-bar.ts:43-72 | 被 sf-game shadow `*` 规则隐式掩盖，重构即右溢 |
| R5-05 | WebGL 失败降级与 WASM 不一致 | app/ui/controller.ts:91-95 | alert 后照常运行，玩家盲玩可写通关记录 |
| R6-04 | gtag 引用不重取 | app/ui/analytics-gtag.ts | 拦截后再加载 gtag 不会生效，建议 emit 前惰性重取 |
| R7-02 | URL 的 dev 键未订阅 | app/ui/app.ts:48,123-133 | popstate 删 dev 参数不生效，与其余键契约不一致 |
| R7-04 | dev-panel touch-action:none 全面板 | app/dev/dev-panel.ts | 面板不可滚动，应收敛到 .head |
| R8-03 | upload_source_maps 惰性旗标 | cloudflare/wrangler.jsonc:19 | 一旦开启 build.sourcemap 即公开完整 TS 源码 |
| R9-03 | 右键=冷源契约零回归测试 | app/ui/input.ts:67-69 | 玩法不变量无守护，可抽出纯逻辑无头测 |
| R9-04 | url-state has()/dispose()/sf 标记零覆盖 | tests/url-state.test.ts | fake source 不捕获 history.state |
| R9-05 | progress 内联修剪零测试 | app/game/progress.ts:107-113 | 守卫配额的关键分支从未触达 |
| R9-06 | golden 基线无自动回填工具（info） | tests/engine-golden.test.ts | 手工回填易错，可加 --print 模式 |
| R10-03/04 | SKILL.md 未更新至 20 关四组；gui-xu 缺求解基线 | skills/level-design/SKILL.md | 文档滞后 + known-solutions 缺口 |
| R10-05 | canPlaceAt 顶带 y<3 与注释矛盾 | app/game/simulation.ts:163-167 | "可设目标、不可放源"窄约束，当前 20 关未触发 |
| R10-06 | loop 异常策略为"记录并停循环"（原表述已修正） | app/core/loop.ts:56-61 | 有 try/catch（console.error + stop）；残留观察：异常停止后无 UI 提示 |
| R10-07 | won+paused 状态机不一致 | app/ui/controller.ts:221-227 | 结算中暂停+历史导航后覆盖层消失而物理冻结 |
| G1-01 | drawBatch 缺 program/lost 守卫 | app/render/gl.ts:320-338 | restore 重建失败后每帧对 null program 发 drawArrays |
| G1-02 | 示踪记录 np 零余量跨文件耦合 | render.ts:496-518 ↔ batch.mbt:26-29 | TRAIL_LEN+1 恰好顶满 stride，单行改动即越界 abort |
| G1-03 | tracers 批量测试只覆盖 np=3 | tests/batch.test.ts:94-109 | 布局契约无边界守护 |
| G2-03 | undo/redo 裸调 history.back() 缺 sf 守卫 | app/ui/app.ts:243-249 | 直达链接会话 Ctrl+Z 直接离开本站 |
| G4-02 | SDF golden 采样网格只覆盖远场角落 | tests/sdf-golden.json | 混合带/过渡区语义漂移不报警 |
| G4-03 | 网格上限 canary 只钉常量镜像不验执行侧守卫 | tests/engine-wasm.test.ts:69-77 | 内核容量守卫零回归保护 |

---

## 8. 实践核实记录（2026-08，本会话实测）

用户授权编辑/跑码后，对报告关键结论逐条用真实代码、真实 WASM 内核与真实命令复核。方法：完整测试基线 → 各发现独立复现脚本（已删除，见下）→ 命令行为实测。全部 26 个测试文件 106 用例基线全绿；`bun run check` 全链实测通过（链中无 tsc）。

### 8.1 逐条核实结论

| 发现 | 原结论 | 实践核实 | 证据 |
|---|---|---|---|
| R3-01（高×高） | 确认 | ✅ **确认** | 3000×3000 网格越界仍执行 9e6 次 SDF 采样（15.7ms、1 条网格错误）；结构非法（w=0）0.03ms 短路——证明短路路径存在但越界分支没用；lvCodec.decode 无长度上限；外推 w=h=1e5 ≈17s、w/h≥2⁵³ 死循环 |
| R4-01（中×高） | 确认 | ✅ **确认（量化）** | 真实内核 marching squares 绘出地面线 y=9.625，物理面 10，偏差 0.3750 = 0.5×cell(0.75)（6636 顶点实测） |
| R8-01（中×高） | 确认 | ✅ **确认（加重）** | 根目录 `bun run check` → "Script not found"；typecheck 独立通过；check 全链无 tsc；移走 wasm 后 vitest 在 setup.ts:8 抛**裸 ENOENT**（实测两次，友好提示分支不可达） |
| R6-01（中×高） | 确认 | ✅ **确认** | governor.record 仅 tier 递增返 true（governor.ts:41-44）；fit 尺寸守卫（controller.ts:192）；keyed 每关重建（app.ts:387）；resize 全仓唯一调用点 |
| R2-01（中×低） | 确认 | ✅ **确认（复现更强）** | 0 校验错误、烘焙场 60/1800 NaN 格、goalAnchorY=NaN **且 spawnY 亦 NaN**、1 步 phase=won（`max(8-y, 0-sqrt((y+3.45)*(y+3.65)))`） |
| G2-02（中×中） | 确认 | ✅ **确认（实测）** | won → 复刻撤销（phase='playing'）→ step → 仍 playing，飞机距圆心 0.5 仍在圆内（僵尸局） |
| G3-01（中×中） | 确认 | ✅ **确认（真实代码 mock）** | vitest 临时测试驱动真实 bgm.ts：静音态创建 volume=0 → setMuted(false) 后仍 0（期望 0.05） |
| G3-03（中×中） | 很可能 | ✅ **确认（代码条件）** | 两处恢复点仅 `state === 'suspended'`（sfx.ts:144/153），interrupted 未覆盖 |
| R6-03（低×高） | 确认 | ✅ **确认（实测）** | 上抛静风 15s：max\|vy\|=1.46、isLanding 触发 0 次、已落地（判定要求 \|vy\|≥21 u/s） |
| R8-02（修正后·低） | 修正降级 | ✅ **确认（实测）** | `Bun.spawnSync(['不存在命令'])` → THREW "Executable not found in $PATH"，友好分支不可达 |
| R3-02（低） | 确认 | ✅ **确认（实测）** | 负条目 total=-5 通过解析；record 被永久拒绝；干净存储对照通过 |
| R1-01（驳倒后·低） | 驳倒 | ✅ **驳倒维持 + 残余成立** | init(256,160,margin=159) 被接受(0)、step 无 trap（40960 满容量吸收）；init(257)→1、init(2,2)→1 拒绝；guard 确实不查 margin/cell（残余建议成立） |
| G4-01 | 驳倒 | ✅ **驳倒维持** | 全套 106 用例全绿；level4 潮汐测试 1s 内通过 |
| G4-03（低） | 确认 | ✅ **确认（实测）** | 执行侧守卫工作正常（init(257)→1、init(2,2)→1），但确无测试覆盖这些负向路径 |
| R7-01（低×高） | 确认 | ✅ **确认** | app/ 中 import.meta.env 出现 0 次；生产 bundle 含"开发者"×6、"dev-page"×3 |
| R8-03（低） | 确认 | ✅ **确认** | dist 无 .map；wrangler.jsonc:19 `upload_source_maps: true` |
| R5-03（低×高） | 确认 | ✅ **确认** | app/ui 中 ~102 处散点 rem 字面量（正则粗计） |
| G2-01（低×高） | 确认 | ✅ **确认** | `.levelId=${this.level?.id ?? ''}` 绑定 Number 属性；20 个关卡 id 全部非数字 slug |
| G2-03（低） | 确认 | ✅ **确认** | app.ts:244/248 裸 history.back()/forward()，vs :183 有 sf 守卫 |
| R2-02（低） | 确认 | ✅ **确认** | 150 × 0.3 = 45 单位路程上限 vs 6s × 7.5u/s 截断点 |
| G1-02（低） | 确认 | ✅ **确认** | stride 80 = 5+25×3；TRAIL_LEN+1=25 恰好写满，零余量 |
| R10-05（低） | 确认 | ✅ **确认（实测）** | canPlaceAt(0.5, 2.0)=false（顶带拒绝）、y≥3 放行 |
| R10-06（低） | 原述"异常无恢复" | ❌ **修正** | loop.ts:56-61 有 try/catch：console.error('游戏循环异常') + stop()。防护存在；残留观察：停止后无 UI 提示（已修正附录条目） |
| R5-05（低） | 确认 | ✅ **确认（代码）** | controller.ts:92-95：WebGL 不可用仅 alert 一次，loop/sim 照常运行 |

### 8.2 核实中的修正与新发现

1. **R2-01 影响面比报告更宽**：实测中不仅 goalAnchorY=NaN，`spawnY = surfaceY(terrain, spawn.x, h)` 同样扫到 NaN 行 → **出生点即 NaN**，飞机一步瞬移进入 won。报告"NaN 主入口是 surfaceY 推导的目标锚点"应改为"surfaceY 推导的出生点与目标锚点均可被污染"。
2. **R10-06 原表述有误**：loop 有异常防护（记录+停循环）。报告附录已修正；剩余可讨论点是"异常停止后玩家无提示"。
3. **R3-01 冻结时长修正**：本会话实测采样速率（9e6 次/15.7ms ≈ 1.7ns/次），w=h=1e5 ≈ 17s（原"约 90s"偏保守）；真正致命的是 w/h≥2⁵³ 的永不终止死循环。
4. **R4-01 首次复现脚本遇校验反例**（"世界内无实体"错误）——是我复现配方错误（sqrt 项在世界内恒正），修正为 `0 - sqrt(...)` 后 0 错误复现；报告结论不受影响。

### 8.3 核实方法说明

- 复现脚本使用**真实生产代码路径**：LevelSimulation + 真实 sfengine.wasm 内核（非 JS 模拟）；R4-01 直接驱动 moon/batch.mbt 编译的 marching squares 内核并读取其顶点输出。
- 临时脚本位于 `sfgame-web/.cr-verify/`（verify-sim.ts / verify-core.ts / verify-r301.ts）与 `tests/.crverify-bgm.test.ts`，**核实完毕已全部删除**；wasm 产物移走两次模拟 fresh clone 后均已恢复；工作区 `git status` 干净（仅本报告文件未跟踪）。
- 基线：`bun run test`（moon + vitest 26 文件 106 用例全绿）、`bun run check`（build→moon test→vitest 全绿、无 tsc）、`bun run typecheck`（通过）。

---

## 9. 修复记录（2026-08，全部完成并验证）

按 P0→P1→P2 全部修正；每批经 typecheck + 全套测试（120 用例）+ moon 测试（15）+ 根目录 `bun run check` 全链验证。

### P0 · 安全与正确性
| 发现 | 修复 | 回归守护 |
|---|---|---|
| R3-01 | `checkWorld` 网格越界 `return null`（烘焙/采样短路）；`lvCodec.decode` 加 16KB 载荷上限 | level-format.test：越界世界恰好 1 条网格错误且不级联；state.test：超长载荷落 null |
| R2-01 | `bakeSdf` 单点发散守卫（非有限即抛 SdfError）；校验改与游戏同路径全域烘焙（窄 NaN 带/边距带全拦截）；`checkGoals`/`surfaceY` 非有限防御 | level-format.test：NaN 带关卡被"求值错误…发散"拒绝 |
| G2-02 / R10-07 | `applySources` 胜利让位时清 visited/visitedCount 并解除暂停（BGM 同步），恢复"下一帧重新判定"契约 | 机制白盒（simulation.restart 是唯一清 visited 点不变） |
| R4-01 | 渲染地形锚点改格心（`gridAnchor` 单源），视域索引同步 −0.5 | batch.test：真实 bakeSdf 场切出 y=10（旧锚点 9.625） |
| R10-05 | 顶部禁带改 `min(3, h/6)`：常规世界行为不变，小世界恒可放置 | placement.test：常规禁带 + h=4 世界可放置 |
| R4-03 | 视域烘焙键改数值四分量比较（去模板串分配） | —（性能微项） |

### P0 · 构建契约
| 发现 | 修复 |
|---|---|
| R8-01 | sfgame-web：check = typecheck → test → build；test 前置 build:wasm；根 package.json 透传 check/test；AGENTS.md/README 同步 |
| R8-02 | `compileWasm` 包 try/catch（工具链缺失友好报错返回 false）；wasm-rebuild `run()` try/finally 复位 compiling |
| R8-03 | wrangler.jsonc `upload_source_maps: false` + 注释 |
| R8-04 | cloudflare/AGENTS.md 重写为实际部署说明（纯静态 assets、无 bindings） |
| R8-05 | 删除 AGENTS.md/README 的 docs/development.md 悬空引用 |

### P0 · 反馈链（玩家体验第一性）
| 发现 | 修复 |
|---|---|
| G3-01 | `bgm.setMuted(false)` 写回 BGM_VOLUME（解除静音恢复音量） |
| G3-03 | 两处 AudioContext 恢复条件改 `state !== 'running'`（覆盖 iOS interrupted）并 catch resume 拒绝 |
| R6-01 | governor 提升为模块级单例（跨关卡延续 tier）；降级路径 `fit(true)` 强制 resize 绕过尺寸守卫 |
| R6-03 | 落地判定改"空中→触地下降边沿"（LAND_ALT=0.05，无速度门槛，响度按撞击 vy 缩放）——静风终端 vy≈1 的普通降落现在有声；wind.test 重写 |

### P1 · 状态与 UI
| 发现 | 修复 |
|---|---|
| G2-01 | `levels.levelNo()` 单源序号；status-bar 改 Number 属性 + 双位补零（与标题屏一致），死功能复活 |
| R5-05 | WebGL 不可用 → 与 wasm 同策略：sf-game 派发 unsupported，app 替换为终端页（unsupported.ts 支持 webgl 文案），不再盲玩写记录 |
| R7-01 | dev 会话（devTools 活跃）不上报 level_start/level_complete；AGENTS.md 明示 |
| R7-02 | bindUrlState 订阅 dev 键（外部变化同步） |
| G3-02 | level_start 上报移到 applyScreen 公共路径（按钮/直达/后退同一漏斗） |
| G2-03 | undo/redo 与 goBack 同款 sf 标记守卫（直达会话 Ctrl+Z 不再离开本站） |
| R6-04 | analytics-gtag 传输惰性重取 window.gtag（晚加载不丢事件） |

### P1 · 内核与测试
| 发现 | 修复 |
|---|---|
| R1-01（残余） | 内核 init 守卫补 cell>0 与 margin∈[0, nx−2]；tracers_init 补 scell>0 |
| R1-05 | 地形烘焙缓冲定容改 9 顶点/格（grid.mbt 注释同步）；canary 同步 cells×9 |
| G1-02 | 内核 b_tracers 读侧 np 钳制 + 渲染写侧 maxPts−1 钳制（成对防御） |
| G4-03 | engine-wasm.test 补负向 canary：超容量/非法 cell/越界 margin init 被拒 |
| G4-01 | 潮汐断言改 3/4 周期波谷（避开 1-ulp 过零点）+ 注释修正 |
| R1-04 | fluid.test 补 margin>0（origin 偏移）三方逐位对拍 |
| G1-03 | batch.test 补 np=25 满记录与 np=26 钳制边界 |
| R3-02 | parseEntry 拒绝负 time/extra；progress.test 补负值毒化回归 |
| R9-05 | progress.test 补 trimInline（超 50 裁最旧、内置不动） |
| R9-03 | input.ts 抽 `buttonKind` 纯函数（右键=冷源不变量）；tests/input.test |
| R9-04 | createBrowserSource 可注入（win 参数化）+ url-state.test 补 has/dispose/sf 标记/popstate+pageshow |
| R2-03 | solve-lib 通关时刻取 step 后 sim.time（与游戏展示口径同源） |

### P2 · 样式/文档/性能
| 发现 | 修复 |
|---|---|
| R5-03 | 新增语义/补位 token（--hud-pad/--chip-pad/--ctl-pad/--maxw-actions/--sp-0-5/1-5/2-5/5-25/5-5）；12+ 处散点间距/内边距收敛；icon-btn place-items 改子项 margin:auto |
| R7-03 / R5-01 | level-editor 与 status-bar 补 boxReset |
| R7-04 | dev-panel touch-action 收敛到 .head 拖拽句柄（面板体可滚动） |
| R4-05 | cloudBuf 容量随 CLOUD_COUNT 单源 + fillClouds 上限守卫 |
| R2-02 | 拖尾容量按 淡出窗×最高航速 推导（150→600 点），高速段不再提前截断 |
| R4-04 / R1-03 | batch.mbt 容量注释、moon 头注释引用改为现存守护测试 |
| R1-02 | pitfalls I8 终局改写（f32x4 移除、f64x2 保留的现状与 AGENTS.md 一致） |
| R10-03/04 | SKILL.md 更新至 20 关；gui-xu（归墟）已跑 `--solve --budget-ms 300000`——GA 未收敛（进展 ~19/110，卡局部陷阱），如实保持未登记并记入 SKILL.md（补登流程同 §6） |
| R9-06 | golden 计算核心抽到 tests/golden-core.ts（单一事实源）；scripts/print-golden.ts 打印/比对工具 |
| G4-02 | sdf-golden.json 每用例新增近场采样点（形状近场/smin/smax 混合带/ss 过渡区），测试同步校验 |
| G1-01 | gl.drawBatch 补 program/lost/count 守卫（与其余入口同纪律） |
| R10-06 | 修正结论：loop.ts 本有 try/catch（异常记录+停循环），无代码改动 |

### 验证基线
- `bun run typecheck`：零错误（TS 7.0.2 native）
- `bun run test`：moon 15/15 + vitest **120/120**（新增 14 个回归用例）
- 根目录 `bun run check`：typecheck → test → build 全链通过（此前 "Script not found"）
- engine-golden / sdf-golden：**哈希与基线一致**（本次改动零数值漂移）
