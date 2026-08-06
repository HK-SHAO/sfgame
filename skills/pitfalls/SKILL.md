---
name: pitfalls
description: 本项目（Lit 3 + Canvas 2D + vite/bun 单页游戏）实踩并验证过的疑难杂症避坑手册。当遇到以下信号时使用：布局右溢/间距消失、居中元素宽度只有一半、滚动条异常、刷新后状态丢失、后退/前进不生效、iOS 或移动端卡顿/无声/手势异常、模拟时间判定失效、长测试超时。每条含症状、根因、修法、可提前识别的信号。修问题先查本手册，再查网络。
---

# 疑难杂症避坑手册

本项目实踩并验证过的坑。每条按「症状 → 根因 → 修法 → 信号」组织。
新增条目：在对应分类追加 `### Xn` 小节，并在「快速检索」补一行 `症状 → Xn`。

## 快速检索（症状 → 条目）

- 布局右溢、右侧间距消失 → A2、A4
- 居中元素（提示条/弹层）宽度只有容器一半 → B4
- 顶部滚不回去、底部间距不可见 → A3
- 刷新后页面/状态丢失 → C6
- 后退/前进"没反应"、源删不掉 → C5
- 后退后历史条目异常 → C3、C4、C7
- 点链接/跳转后 URL 状态（如 ?dev=1）丢失 → C9
- 返回按钮跳到别的网站/空白页（直达链接场景）→ C10（history.length 不可靠）
- iOS 卡顿/掉帧 → D1、D2、D5、D7
- Canvas 2D 描边/渐变负载高、想上 WebGL → D7
- WebGL 上下文恢复后白屏/资源泄漏 → D9
- 整页白屏且 console 是模块初始化抛错（关卡解析等，非 WebGL） → D11
- shadow DOM 内"按到哪个内部控件"判定失效（拖不动/一按就拖） → A10
- Lit 交互"点了没反应/慢半拍"（状态是普通字段） → A11
- 上下文恢复后地面/天空缺失（动态层正常） → D10
- 淡出/裁剪逻辑让物体整体消失 → D8
- 切后台回前台无声 → F2
- 长按弹系统菜单/双击缩放 → E1
- 右键放错源 → E2
- 整数秒时间判定失效 → G1
- vitest 长模拟超时 → G3
- 搜索类算法跑不完 → G4
- 关卡调参/解法搜索：粗筛胜点在精验翻车 → G6
- 参考解"看起来能通"但玩家摆偏 1 格就废 → G7
- 贴地飞机"推不动"疑为 bug → G8
- 布局测量与预期不符 → A1、H1
- 挂进宿主元素的覆盖层元素"消失"（getBoundingClientRect 全 0/视口外）→ A9
- CSS/样式改了却不生效（Lit 模板里写了 `//` 注释） → A12
- 想用 wasm/代码生成/Worker 加速、移动端"应该更慢"的想当然 → I1、I5
- run-level --verify/--solve 输出"通关 0.0s · 路程 NaN" → I8（bun 运行时 WASM·SIMD 误执行，先验过 vitest）
- 只有 iOS Safari 卡、其他平台都好 → I6（Metal 后端渲染路径）
- headless Chrome 截图/验证画面空白或只有背景色 → I7
- AS/wasm 移植后数值"差不多但不对"（整数字面量相除截断）→ I9
- vite dev 自动化访问 127.0.0.1 失败（000）→ I2
- bun 跑脚本报 stdio/进程残留/端口占用 → I3

## A. Lit + Shadow DOM

### A1 布局测量三件套不一致时先查 transform/zoom
`getBoundingClientRect().width`（含 transform）、`offsetWidth`（布局宽）、`getComputedStyle().width`（CSS 宽）三者应一致；不一致 → 有 `transform`/`zoom`/未回流。逐级祖先查 `getComputedStyle(el).transform !== 'none'`。

### A2 全局 `* { box-sizing: border-box }` 不穿透 shadow DOM
**症状**：窄屏右溢；`width:100% + padding` 的盒子比预期宽；`max-width` 反而把卡片钉在超出视口的宽度。
**根因**：全局样式表不进影子根，组件内实际是 `content-box`——`width:100%` 是内容宽，padding 再加到盒子外，总宽超过 `max-width` 时被按 border-box 语义压缩，越界。
**修法**：每个 Lit 组件 `static styles` 开头自声明 `*, *::before, *::after { box-sizing: border-box }`。
**信号**：自定义元素内任何尺寸与预期不符，先查这个。

### A3 `place-items: center` 溢出双向裁切
**症状**：内容超高时顶部滚不回去、底部内边距看不见。
**根因**：grid/flex 居中在溢出时两端同时被裁。
**修法**：容器保留 `display: flex`（column），子项用 `margin: auto`——适配时居中，溢出时 margin 塌缩为 0、从顶部可滚动、底部间距可见。
**信号**：任何"居中 + overflow:auto"的组合。

### A4 grid 中百分比宽度循环解析
**症状**：`width: min(35rem, 100%)` 或 `max-width: 100%` 在窄屏解析出比视口还大的值，右溢。
**根因**：grid 自动轨道按项目 max-content 定尺寸，`100%` 解析到被撑大的轨道（循环）。
**修法**：flex 列 + `width: 100%; max-width: 35rem; margin: auto`；或纯块级 + `margin: 0 auto`。
**信号**：单测/隔离复现（内容很小）测不出来——**必须用真实内容量级的页面测**（H1 探测法）。

### A5 装饰器 + `useDefineForClassFields: false`
`@query()` 只生成 getter，字段必须 `!` 断言且**不能带初始化器**，否则运行时报 "has only a getter"。

### A6 不要在 updated()/firstUpdated() 内设置响应式属性
触发 `change-in-update` 告警；派生状态用 `willUpdate`。

### A7 事件名必须静态
`@hudchange=` 可以，`@${var}=` 不行。

### A8 canvas 的 parentElement 恒为 null
canvas 是 shadow root 直接子节点，不能隐式推断宿主，尺寸适配的宿主必须显式传入。

### A9 无 `<slot>` 的 shadow 组件：append 到宿主的 light DOM 子元素不可见
**症状**：往宿主元素 `host.appendChild(el)` 挂覆盖层（计时条/弹层），元素在 DOM 树里、`querySelector` 找得到，但 `getBoundingClientRect` 返回 0 或视口外坐标（不渲染）。
**根因**：自定义元素有 shadow root 且 render 模板没有 `<slot>` 时，light DOM 子元素不参与渲染（shadow 模式默认不显示 light 内容）。
**修法**：要么给组件加 `<slot>`，要么把覆盖层挂到 `document.body`（fixed 定位，与视口对齐；游戏内 app 的 shadow 外挂 perfEl 即此先例）。验证时注意查询路径：body 下直接 `document.querySelector`，shadow 内要逐层进 `shadowRoot`。

## B. 布局 / 响应式 / 单位

### B1 根字号随视口缩放实现全站 rem 适配
`html { font-size: clamp(14px, calc(12.5px + min(0.7vw, 0.38vh)), 17px) }`——宽、高双向约束，矮窗（横屏手机/小笔记本）自动收紧防纵向溢出。组件内一律 rem，不再逐屏写断点。
**信号**：任何新尺寸都用 rem，不用 px（px 仅保留特殊情形：发丝线、动画位移、胶囊 999px、媒体查询断点、env(safe-area)、阴影）。

### B2 纵向溢出兜底必须可滚动且不裁切
横屏手机等极矮视口放不下时，正确行为是"可滚动 + 底部间距可见"（见 A3），而不是裁切。能接受极小视口有滚动条，主流屏幕（≥560px 高）应无。

### B3 headless Chrome 测量注意
`--window-size` 是最外层窗口，内层视口更小且有 500px 最小宽。测量用 `window.innerWidth/innerHeight`，断言布局用注入脚本读 computed style + bounding rect（详见 H）。

### B4 绝对定位居中元素宽度上限只有容器一半
**症状**：`position: absolute; left: 50%; transform: translateX(-50%)` 居中的提示条/弹层，`max-width: 92%` 设了却永远到不了，实际宽度只有容器一半。
**根因**：无显式宽度的绝对定位元素按 shrink-to-fit 定宽，其可用空间 = 包含块 − left 偏移 = 50%，`max-width` 只是上限、不是目标宽度。
**修法**：加 `width: max-content`（宽度贴内容成胶囊，`max-width` 恢复封顶换行职责）；或直接给显式宽度。
**信号**：任何 `absolute + left:50% + 无 width` 的组合，且内容比预期窄。

## C. URL 状态 / 撤销重做

### C1 分隔符避百分号转义
`URLSearchParams` 必转 `,` `;` 空格。用 `-`/`_` 做分隔符 + 枚举值缩写（`h`/`c`），全程零 `%`。

### C2 写读分离防反馈环
`set/clear` 不回调订阅者（写方自知）；`onChange` 仅响应外部 URL 变化（popstate）。否则"写入→回读→再写入"死循环。
**信号**：set 之后 onChange 又触发。

### C3 等值 set 必须跳过
按**编码后的字符串**比较，不是引用/值比较——防历史污染（pushState 多余条目）。

### C4 微任务批量写入
同帧多次 set/clear 只 pushState 一次（否则一次操作多条历史）。

### C5 差异算法比对"目标列表"
**症状**：后退/前进"没反应"、源删不掉。
**根因**：移除时与"场上当前状态"比对 → 永不删除。
**修法**：与目标列表比对；存活源保留原 id/born（不重播生长动画）。位置容差对齐 URL 精度（1 位小数 → 容差 ≥0.05）。

### C6 所有重要状态进 URL
纯组件状态刷新即丢。页面视图也要持久化（如 `?view=solutions`），优先级规则要确定（view 优先于 level）。

### C7 非规范 URL 规范化会多一条历史
挂载时初始应用用 silent（不回写 URL）。

### C8 iOS bfcache 后退 popstate 不可靠
`pageshow` 兜底重对齐；幂等——URL 未变则 sync 无变化零开销。

### C9 新建/替换 URL 时先复制当前参数，只动目标键
**症状**：从解法参考页带 `?dev=1` 点进解法，dev 消失（dev 模式被关）。
**根因**：`solutionUrl` 从零拼 `?lv=..&src=..`——其他状态全丢。
**修法**：`new URLSearchParams(base)` 复制当前查询参数，仅 `set`/`delete` 目标键（与 urlState.flush 同构）；被跳转的"页面视图"键（如 `v`）须显式删，因其优先于目标视图。
**信号**：手写拼 URL 字符串、链接 href 不含当前其他参数。

### C10 返回判定别用 history.length：pushState 带应用标记
**症状**：直达链接/新标签页进子页面点"返回"跳到别的网站或空白页；`window.history.length > 1` 时 `history.back()` 会离开本站（length 是整个会话栈，含外部站点）。
**修法**：应用内 pushState 统一带 `{ sf: true }`（url-state 唯一写入点），`replaceState` 保留当前条目标记（应用条目不丢、文档条目不被污染）；返回按钮按 `window.history.state?.sf` 决定 `back()` 还是回首页。
**信号**：任何"返回上一页"按钮；手写 `history.back()` 或依赖 length 的判断。

## D. 渲染性能（Canvas 2D）

### D1 移动端 iOS Canvas 2D 是 CPU 栅格化
每帧 `createRadialGradient` 既贵又有累积风险 → 渐变烘焙成精灵位图，每帧只 drawImage。

### D2 渲染必须节流
120Hz 屏 rAF 以 120Hz 触发，但模拟只步进 60Hz——只在"有模拟步进的帧"渲染，否则双倍负载渐进掉帧。倍速（GameLoop.setRate）下每帧都步进，渲染再封顶 60Hz（距上次渲染 ≥ SIM_DT 才画）——高速率只放大 tick 成本，不放大渲染负载。

### D3 批量描边替代逐段提交
按透明度/温度等分桶 Path2D，每桶一次 stroke。移动端从最多 ~150 次路径提交降到个位数。
**信号**：每帧路径提交数 = 元素数 × 段数。

### D4 热路径零分配
每帧 `{x:0,y:0}` 之类的临时对象 → 复用字段。采样临时量用共享对象。

### D5 ResizeObserver 抖动/循环
尺寸未变则跳过 resize，否则画布每帧重建（iOS 已知坑）。

### D6 自适应降级要防误触发
帧开销 EMA（平滑 0.95）+ 慢帧计数（如持续 150 帧超 13ms 才降级）——偶发卡顿不降级；先降粒子档，到底再降 dpr。
**倍速下帧预算按速率放大**（预算 × rate）：每帧本就要消化 rate×tick，慢帧是预期而非故障；且主导成本（流体）不可降级，阶梯在高速率下只会白降画质。**追赶封顶**：单帧最多消化 60 模拟步（≈1s 模拟），暂停回归在 16× 下不会单帧冻结。

### D7 Canvas 2D → WebGL1 批量渲染（#7 性能重构的结论与要点）
iOS Safari 的 Canvas 2D 是 CPU 栅格化（D1），逐帧上万段 Path2D 描边是瓶颈；WebGL1 在 iOS 8+/全部 WebView 可用且 GPU 加速，是兼容性最优解（WebGPU 太新；物理数值内核 #20 起另走 WASM·SIMD，见 I1）。落地要点：
- **公共 API 不变**：Renderer 的 constructor/resize/toWorld/draw 保持原签名，控制器与 UI 零改动。
- **顶点批 `render/batch.ts`（纯计算无 DOM，可无头测试）+ `render/gl.ts`（上下文/着色器/缓冲薄层）**：整帧一个动态 VBO、一次 drawArrays(TRIANGLES)。
- **GL `lineWidth` 多平台恒为 1**：线宽必须几何化——线段沿法线展开为四边形（`stroke()`），别指望 `gl.lineWidth`。
- **逐顶点颜色取代分桶**：透明度/颜色不再离散分桶（Canvas 的 strokeStyle 状态机所迫），每段直接带精确 RGBA，一次提交。
- **径向渐变 = 扇形逐顶点插值**：中心色→边缘色线性插值即等价两端色标的 createRadialGradient，免每帧建渐变与精灵烘焙。
- **顶点缓冲是 float32**：无头测试断言用 toBeCloseTo（容差 1e-5），别用 toEqual 精确比较。
- **上下文回收**：iOS 内存压力会销毁 WebGL 上下文——`webglcontextlost` 要 preventDefault，`webglcontextrestored` 重建程序/缓冲。
- **混合**：`SRC_ALPHA / ONE_MINUS_SRC_ALPHA`（非预乘），与 Canvas rgba 语义一致；`alpha:false` 画布不透明，天空由场景自铺满。
- 静态背景烘焙进离屏纹理（FBO）：仅 resize/上下文恢复后重烘焙，动态层每帧重建——烘焙失败要保留脏标记重试，别清掉后静默空背景（D10）。

### D9 webglcontextrestored 重建失败会静默白屏 + 重复恢复泄漏 GPU 对象
**症状**：iOS 内存压力回收上下文后画面空白；或多次恢复后显存持续上涨。
**根因**：restored 回调里重建程序/缓冲，但 (1) 重建失败（编译/链接错误）时静默早退，`program`/`buffer` 仍是已随上下文销毁的旧对象，draw 继续误用 → 白屏且无重试路径；(2) 每次重建都不删旧 shader/program/buffer → 重复恢复反复泄漏。
**修法**：`init()` 开头 `dispose()` 删旧对象（恢复后旧对象本已失效）；失败路径删除已创建对象并置空指针返回 false，restored 回调据返回值报错——draw 检查 `!program` 跳过，不碰失效对象；shader 在 link 成功后即可 delete。
**信号**：上下文恢复相关代码出现"早退不清资源"或"重试不清理旧对象"。

### D10 上下文恢复后烘焙背景丢失（地面/天空缺失、动态层正常）
**症状**：偶现"地面/天空没了"，飞机/粒子还在动；刷新或改窗口大小即恢复。
**根因**：restored 只重建 program/缓冲，离屏背景纹理/FBO 随上下文销毁后没有重建，且 Renderer 的 `bgDirty` 为 false 不会重烘焙——draw 落入"背景未就绪"兜底清屏，只画动态层。
**修法**：restored 里 init 成功后立即 `resizeBg()` 重建纹理/FBO 并置 `bgStale`，Renderer 烘焙条件为 `bgDirty || gl.bgStale`；`bakeBg` 检查 `checkFramebufferStatus`，不完整则重建 FBO 并保留脏标记下帧重试。
**2026-08 续坑（原修法仍有洞）**：`bakeBg` 失败路径（FBO 瞬态不完整/纹理分配失败）返回后，Renderer **无条件**清掉了 `bgDirty`/`bgStale`——重建出的空纹理或兜底清屏会一直顶到下次 resize/上下文事件，即"刷新或改窗口大小才恢复"的偶现白底。**修法三件套**：(1) `bakeBg`/`resizeBg` 返回 boolean，烘焙失败时调用方**保留脏标记**，且 `bakeBg` 失败路径就地重建 FBO/纹理，下一帧的检查即对新建对象进行；(2) `resizeBg` 里 `createTexture`/`createFramebuffer` 返回 null（显存压力）时指针置 null 返回 false，走同一重试链；(3) 烘焙条件加 `!gl.bgReady`，纹理缺失即使无脏标记也强制进块自愈。浏览器实测：注入纹理丢失后 ~2 帧内自动恢复。
**信号**：离屏纹理/缓存的资源在"上下文恢复"路径没有重建入口；烘焙失败路径出现"无条件清脏标记"。

### D8 淡出/裁剪的早退别跳过物体本体
旧 `drawPlane` 在 `alt >= SHADOW_FADE_ALT` 时直接 `return`——连飞机本体都不画，高空飞机凭空消失。**影子淡出是"局部效果"，早退只能跳过影子那段**；任何"某效果随条件淡出"的代码，先确认早退范围不含主体绘制。重构渲染时优先审这类 early-return。

### D11 模块级初始化抛错 → 整包白屏（如关卡解析失败）
**症状**：改坏一个关卡 YAML（如 `r: 0`）后刷新页面直接白屏，console 是模块求值时的 `Uncaught Error: 关卡校验失败…`。
**根因**：`levels.ts` 在模块顶层 `LEVEL_TEXTS.map(parseLevelText)`——任一条解析抛错，整个 bundle 求值失败，连 `sf-app` 都注册不了，任何错误 UI 都没有机会渲染。
**修法**：逐项 try/catch 容错加载（坏关卡进 `LEVEL_ERRORS` 清单，模块永不抛）；UI 在标题页渲染告警卡（`role="alert"` 红底小卡列出错误原文）；依赖首关的字段初始化（如 `hud` 的预算初值）用 `?.` + `?? 0` 兜底，`startGame` 找不到关卡直接 return。
**信号**：任何"模块顶层立即执行解析/编译/IO"的代码（关卡、JSON、wasm 初始化）——一律逐项容错 + 错误清单外显，白屏是最大的鲁棒性失败。

### A10 shadow DOM 内 pointerdown 的 e.target 被重定向成宿主
**症状**：自定义元素内部"从某子元素按下"的判定失效——要么什么都拖不动，要么按钮/输入框一按就触发拖动（dev 面板拖拽冲突实测，2026-08）。
**根因**：监听器绑在宿主上、目标在 shadow 树内时，事件跨过边界 `e.target` 会被**重定向成宿主**，`e.target.closest('.head')` 永远不中（反之排除检查 `closest('button, textarea')` 也永远不中）。
**修法**：判定真实命中元素用 `e.composedPath()[0]`（shadow 树内原目标），再 `closest()`。
**信号**：宿主元素监听 pointer 事件、要区分"按在哪个内部控件上"的代码——一律走 composedPath()[0]。

### A11 Lit 组件字段缺 @state：赋值不触发重渲染，交互"明显延迟"
**症状**：按钮点击后要等 1~2 秒才看到画面变化（dev 面板展开/收起实测，2026-08）；分拆独立组件后甚至完全不更新。
**根因**：`expanded`/`editorText` 等交互状态是普通类字段，`this.expanded = true` 不触发 Lit 更新——旧版靠周期 `refresh()` 的 `requestUpdate()`"顺带"重绘（90 帧 ≈ 1.5s 一次），于是交互总有 1.5s 级延迟；新版没有周期刷新就永不重绘。
**修法**：所有驱动模板的状态字段一律 `@state()`（含外部直接赋值读取的，如 `paused`）。
**信号**：组件内有"点了没反应/慢半拍"的交互字段——查它是不是普通字段；组件依赖外部周期性 requestUpdate 才更新。

### A12 Lit CSS 模板里 `//` 不是注释：整条规则静默失效
**症状**：给 `static styles` 某条 CSS 声明加 `// 注释` 后该规则完全不生效（如宽度规则失效、盒子缩回内容宽），无任何报错；`:host` 里混入更隐蔽（整块 :host 声明可能被废）。
**根因**：`css` 标签模板把内容原样拼进 `<style>`，CSS 里 `//` 是非法词法（CSS 注释只有 `/* */`），解析器按错误恢复规则吞掉后续声明。
**修法**：CSS 模板里注释一律 `/* */`；`//` 只允许写在模板外的 TS 代码处。
**信号**：改动只加/改了注释、某样式却失效——先查注释写法；dev 面板宽度类规则尤其常见。

## E. 手势 / 移动端

### E1 `touch-action: none` + `user-scalable=no`
否则长按弹系统菜单、双击缩放。
**2026-08 续坑**：视口 meta 已 `user-scalable=no`，但用户开启系统辅助缩放（Settings → 缩放）时该 meta 被忽略，iOS 双击按钮仍会放大页面。**修法**：在根元素（`sf-app`）设 `touch-action: manipulation`——祖先值约束全部后代（canvas 自身 `none` 取更严交集，拖尾手势不受影响），双击放大被禁、滚动保留。Android 无此问题。

### E2 右键与左键冲突
`pointerdown` 只处理 `button === 0`（右键若放行会先走热源 tap 流程），右键放冷源走 `contextmenu`（preventDefault）。

### E3 长按判定用定时器 + 位移阈值
长按达阈值即确认（380ms），位移超过 slop（14px）取消；pointercancel 清理所有轨道与定时器。

## F. 音频（WebAudio）

### F1 iOS 必须用户手势中创建/恢复 AudioContext
`pointerdown` 时 unlock（`ctx.resume()`）。

### F2 后台挂起 + 恢复可见立即恢复
`visibilitychange`：hidden → suspend；visible 且 suspended → resume（**不依赖下次触摸**，否则切回页面无声）。

### F3 WebKit 音频图持有已完成节点
一次性音源播完后显式断开整条节点链（ended 事件），否则长会话累积 → GC 压力与掉帧。

## G. 物理模拟 / 测试

### G1 时间累积浮点误差
`t += 1/60` 累积后 `Math.floor(t) === t` 在整数秒处失效（只命中一次）。用整数步数：`step % 60 === 0`。

### G2 确定性模拟可作测试断言
无随机项的模拟，通关时刻确定 → 测试断言"解可通关"且通关时间与记录一致（±2s 容差）。

### G3 vitest 长模拟必须显式传超时
`test('...', () => {...}, 30000)`——默认 5s 必挂。

### G4 高时间复杂度的搜索算法先评估
运行前估算复杂度与耗时（如 13³ 网格 × 45s 模拟 ≈ 数小时——先算再跑）。用有界候选集 + 早退。

### G5 批量"删注释"编辑事故
用整块替换删注释时，oldString 稍不精确就把常量/方法本体一起删掉。**每次批量编辑后立即 `tsc -b` 验证**；删常量前先 `rg` 确认其引用位置。

### G6 两段式搜索：粗筛 dt 胜点必须精验（#10 关卡调参实测）
**症状**：`dt=1/30` 粗筛出的胜点在 `dt=1/60` 精验时 -1（不通关）——粗筛全假阳性，白跑数小时；反过来，**已知参考解在粗筛下也可能假阴性**（实测 L1 参考解粗筛 60s 不通关，精筛 22.2s 通关）。
**根因**：流体/刚体对 dt 敏感，粗 dt 是"另一套物理"，能造出粗筛独有捷径（也能丢掉精筛独有的解法）。
**修法**：调参统一两段式——粗筛（`dt=1/30`、cap 25s、早退）只用于砍掉明显不行的组合；**所有候选必须 `dt=1/60` 精验**（浏览器固定步长 SIM_DT=1/60，精验即与真机一致）。#10 验收后改为**搜索直接跑精筛**（`run-level.ts --solve` 的 worker 固定 `dt=1/60`、cap 35s + 贴地早退），彻底消除 dt 假象；搜索前先估复杂度（单次评估 ≈ 1–2s），加墙上时间预算 + 每代打印进度，超预算即止。
**信号**：任何"搜索找到解但测试不过/真机不通"的差异，先查 dt。

### G7 参考解的扰动鲁棒性抽查（可玩性代理指标）
**症状**：参考答案能通关（测试绿），但玩家手指偏 1 格就完全不通关——解法参考页给的是刀尖路径。
**根因**：时间最优解往往贴着站点圆边缘擦过，轨迹对源位置极敏感。
**修法**：把参考解每个源做 ±1 单位（8 方向）扰动，统计仍通关比例。教学关建议 ≥6/8；全挂则放大站点圆（r 9-11）或换布局。注意：本作参考解本质是"速通线"，2/8~8/8 都正常，只要不是"除了精确点全废"。
**信号**：站点圆 r<8 且解法只擦边通过 → 先扩圆再谈速度。

### G8 冷/热源"贴地难滑动"是预期物理，别当 bug
**症状**：飞机落地后水平风推不动、或滑得极慢，怀疑流体失效。
**根因**：地面边界层刻意让贴地飞机难再起飞、难滑动（GROUND_SLIDE_K/贴地摩擦）——这是"贴地滑进目标圈不算过关"不变量的一部分。
**修法**：设计关卡时让飞机**保持飞行**（轨道上放热源接力），或接受慢速滑行作为谜题节奏；别为"让贴地飞机被风推走"改物理。
**信号**：新关卡依赖贴地水平推进 → 预判会很慢，重新布局。

## H. 布局调试方法论（实测有效）

### H1 数值化探测替代目测截图
注入探针脚本读 `getComputedStyle` + `offsetWidth` + `getBoundingClientRect` + 祖先 transform，多尺寸（320–1920）headless Chrome 验证。
**隔离复现不可信**：布局 bug 往往只在真实内容量级下触发（如 A4 百分比循环），必须用真实页面测。

### H2 三数值不一致 → 先查 transform/zoom（A1）；样式对但布局错 → 查 box-sizing（A2）

## I. 双环境工具链 / 浏览器自动化（实测）

### I1 加速技术先跑真机基准再定默认（wasm 血泪教训，2026-08）
**实测**：MoonBit 逐位一致的 wasm 求解器在**所有实测平台都比 JS 慢**——iPhone Safari +48%、macOS Safari +39%、Chrome +142%（JIT 引擎的 JS typed-array 数值循环已接近原生，wasm 的调用/转换开销是负资产），该套代码已移除。**但 #20 改用 AssemblyScript 在更大网格/更重内核上重新实测：WASM·SIMD 全面领先（~2-4×），遂定为唯一后端**；#21 按老大指示移除全部 JS 流体后端与切换机制（`?be=`、`--backend`、bench-backend）。
**教训**：上任何加速技术（wasm/代码生成/Worker）前，先做真机基准再定默认；结论随时间与实现水平变化，过时基准要重测。当前（2026-08）基准：流体 0.5ms（JS 时代）→ wasm 迁移后更低、倍速帧 16× <12ms。
**帧成本画像（2026-08-06 V8 实测，LEVEL_2 101×75 网格、400 粒子）**：fluid.step 0.57ms/tick · tracers.step 0.08ms · drawTracers JS 循环 0.04ms · 整帧批组装（6.6 万顶点）0.57ms——成本在 wasm 内部 tessellation，不在跨边界（单次边界调用 ≈3ns，每帧 ~2000 次仅 ≈6µs）。剩余 JS 数值循环合计 <0.15ms/帧，暂无有意义的 wasm 迁移目标；再要提速走渲染算法层（降顶点/实例化），别再想"JS→wasm"。
**注**：bench 工具链（bench.html、scripts/bench*.ts、src/dev/bench-core.ts）已按老大指示移除（2026-08）；浏览器验证用 chrome-devtools-mcp 直连（原 CDP 一致性脚本 `scripts/browser-consistency.ts` 已随之移除）。

### I2 vite dev 只绑 IPv6 回环
**症状**：vite dev 起来了，`curl http://127.0.0.1:端口` 连接失败（000），`localhost` 正常。
**根因**：vite（新版本）只监听 `::1`。自动化脚本访问 dev server 一律用 `http://localhost:端口`。
**信号**：headless 自动化/curl 探测 127.0.0.1 失败但浏览器手开正常。

### I3 bun 的 node:child_process 兼容坑
- `spawn` 的 `stdio` 传 stream（createWriteStream 等）报 "TODO: stream.Readable stdio"；传 `Bun.file()` 报 "Invalid stdio option"。
- **修法**：脚本统一用原生 `Bun.spawn([cmd, ...args], { cwd, stdout: 'ignore', stderr: 'ignore' })`，cwd 必须显式（vite 从 cwd 找配置/根，cwd 错会 404）。
- `bunx` 会产生孙进程，kill 不掉会占端口——直接跑 `node_modules/xxx/bin/xxx.js`。

### I4 浏览器自动化：chrome-devtools-mcp 直连（原 CDP 脚本已移除）
headless Chrome 自动化现直接用 chrome-devtools-mcp 工具连接（页面快照/JS 求值/网络/追踪），无需自维护 CDP 客户端。原零依赖 CDP 方案（`scripts/cdp-client.ts` + `scripts/browser-consistency.ts`）已随其接入移除（2026-08）。

### I5 真机基准页的"帧预算"解读
iPhone 上 `performance.now()` 分辨率 ~1ms：p95 出现整齐的 1.000ms 是量化底噪，不代表真实抖动；看 mean 与整帧构成（倍速帧项）判断瓶颈。iOS Safari 的 fluid JS 比桌面还快（0.49ms）——**"移动端更慢"要逐平台实测，别想当然**。

### I8 bun 运行时误执行 WASM·SIMD 内核（2026-08，bun 1.4.0-canary）
**症状**：`bun run scripts/run-level.ts --verify` 对注册解输出「通关 0.0-0.1s · 路程 NaN」，`--sim` 正常；同一关卡 vitest（node 运行时）通关时间与记录一致。偶发 `abort 167:45 / 1304:64`（advectPass 的 Float32Array 越界检查在字段全零、数学上不可能越界时触发）。
**根因**：bun（JSC）对含 SIMD 指令的 wasm 模块存在误编译，advectPass/平流路径产出越界或发散值（实测同一二进制 node/V8 与浏览器逐位正确）。`evalCandidate` 已加 NaN 守卫——发散即抛错，绝不输出假通关。
**修法**：脚本验证改用 vitest 侧（`solutions.test.ts` 注册解 ±2s 天然覆盖）或浏览器实测；等 bun 修复后恢复 run-level 工作流。JS 回退后端已随 #21 移除，无备用后端。

### I6 iOS Safari WebGL（ANGLE→Metal）性能要点（2026-08 实测 + WebKit bug 255987）
**根因**：iOS 15.4 起 WebGL 默认走 Metal 后端，同内容 GPU 负载显著更高（"内容本质是 GPU 受限"），另有帧呈现依赖（254912，可致有效 30fps）等系统问题；Chrome/Android/macOS Safari 无此问题。
**对策**（已落地）：
- **MSAA 全平台开启**（2026-08-06 产品决策：视觉统一如桌面端，不按平台预降档；iOS 上 MSAA 作用于整个帧缓冲、是最大开销之一，其成本由 governor 实测自适应降档兜底——iOS 复现卡顿优先疑这里）
- **静态背景烘焙到离屏纹理**（resize 时重建），每帧一次不透明 blit；动态层保持混合
- **不透明/混合两趟绘制**：PowerVR 平铺 GPU 上全屏混合直接放大成本
- **blend 状态每帧幂等重设**：canvas 尺寸变更会重置上下文状态，init 里设一次会失效
- **渲染门控加容差**（`>= SIM_DT_MS - 1`）：60Hz 下 rAF 抖动会跳过半数渲染 → 16/33ms 交替伪 30fps
- 调试：`?dev=1` 叠加层（src/dev/perf.ts）实时 fps/p95/max/tick/batch/load/顶点/上传/粒子档/dpr
**信号**：只有 iOS Safari 卡、其他平台都好 → 先怀疑 Metal 后端渲染路径，别动物理。

### I7 headless Chrome 默认无 WebGL
**症状**：headless Chrome（`--headless=new`）里 `getContext('webgl')` 返回 null，游戏画面空白/只有 CSS 背景色；还容易误判为产品 bug。
**修法**：加 `--enable-unsafe-swiftshader`（软件 WebGL）。注意 SwiftShader 性能不代表真机，只用于管线正确性验证。

### I9 AssemblyScript 整数字面量相除会截断（2026-08，#23 逐位对照抓出）
**症状**：AS 移植的几何代码与 JS 逐位对照时，插值系数（如 `7/27`）产出 0 而非 0.259——渐变环颜色全错，画面却"看起来正常"，目测无法发现。
**根因**：AS 静态类型：`7 / 27` 两操作数推断为 i32，整数除法截断为 0；JS 同写法是浮点除。
**修法**：显式浮点 `<f64>7 / 27`（或 `7.0 / 27.0`）。移植 JS 数值代码后必须跑逐位对照（旧/新实现同场景比对 Float32Array），别靠目测。
**信号**：AS/wasm 移植后视觉"差不多但不对"、逐位对照出现整常数差异。

### H3 Lit 3 样式在 `shadowRoot.adoptedStyleSheets`
无 `<style>` 标签，查生效规则读 `cssRules` 的 `cssText`。
