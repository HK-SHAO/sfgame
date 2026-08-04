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
- iOS 卡顿/掉帧 → D1、D2、D5、D7
- Canvas 2D 描边/渐变负载高、想上 WebGL → D7
- WebGL 上下文恢复后白屏/资源泄漏 → D9
- 淡出/裁剪逻辑让物体整体消失 → D8
- 切后台回前台无声 → F2
- 长按弹系统菜单/双击缩放 → E1
- 右键放错源 → E2
- 整数秒时间判定失效 → G1
- vitest 长模拟超时 → G3
- 搜索类算法跑不完 → G4
- 布局测量与预期不符 → A1、H1
- wasm/MoonBit 构建、JS↔wasm 数据交换、双环境（浏览器+node）加载资源 → I1~I6
- 弱引擎（无 JIT）性能差、想上 wasm 加速 → I7
- bun 跑脚本但 node 与 bun 行为不一致（WebAssembly/fetch/spawn）→ I2、I3、I5

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
iOS Safari 的 Canvas 2D 是 CPU 栅格化（D1），逐帧上万段 Path2D 描边是瓶颈；WebGL1 在 iOS 8+/全部 WebView 可用且 GPU 加速，是兼容性最优解（WebGPU 太新、WASM 物理收益不抵工具链复杂度）。落地要点：
- **公共 API 不变**：Renderer 的 constructor/resize/toWorld/draw 保持原签名，控制器与 UI 零改动。
- **顶点批 `core/batch.ts`（纯计算无 DOM，可无头测试）+ `ui/gl.ts`（上下文/着色器/缓冲薄层）**：整帧一个动态 VBO、一次 drawArrays(TRIANGLES)。
- **GL `lineWidth` 多平台恒为 1**：线宽必须几何化——线段沿法线展开为四边形（`stroke()`），别指望 `gl.lineWidth`。
- **逐顶点颜色取代分桶**：透明度/颜色不再离散分桶（Canvas 的 strokeStyle 状态机所迫），每段直接带精确 RGBA，一次提交。
- **径向渐变 = 扇形逐顶点插值**：中心色→边缘色线性插值即等价两端色标的 createRadialGradient，免每帧建渐变与精灵烘焙。
- **顶点缓冲是 float32**：无头测试断言用 toBeCloseTo（容差 1e-5），别用 toEqual 精确比较。
- **上下文回收**：iOS 内存压力会销毁 WebGL 上下文——`webglcontextlost` 要 preventDefault，`webglcontextrestored` 重建程序/缓冲。
- **混合**：`SRC_ALPHA / ONE_MINUS_SRC_ALPHA`（非预乘），与 Canvas rgba 语义一致；`alpha:false` 画布不透明，天空由场景自铺满。
- 静态背景不必再离屏缓存：天空/地形/光晕每帧重建仅数百顶点，GPU 可忽略，还省掉 bgKey/bg 位图的缓存复杂度。

### D9 webglcontextrestored 重建失败会静默白屏 + 重复恢复泄漏 GPU 对象
**症状**：iOS 内存压力回收上下文后画面空白；或多次恢复后显存持续上涨。
**根因**：restored 回调里重建程序/缓冲，但 (1) 重建失败（编译/链接错误）时静默早退，`program`/`buffer` 仍是已随上下文销毁的旧对象，draw 继续误用 → 白屏且无重试路径；(2) 每次重建都不删旧 shader/program/buffer → 重复恢复反复泄漏。
**修法**：`init()` 开头 `dispose()` 删旧对象（恢复后旧对象本已失效）；失败路径删除已创建对象并置空指针返回 false，restored 回调据返回值报错——draw 检查 `!program` 跳过，不碰失效对象；shader 在 link 成功后即可 delete。
**信号**：上下文恢复相关代码出现"早退不清资源"或"重试不清理旧对象"。

### D8 淡出/裁剪的早退别跳过物体本体
旧 `drawPlane` 在 `alt >= SHADOW_FADE_ALT` 时直接 `return`——连飞机本体都不画，高空飞机凭空消失。**影子淡出是"局部效果"，早退只能跳过影子那段**；任何"某效果随条件淡出"的代码，先确认早退范围不含主体绘制。重构渲染时优先审这类 early-return。

## E. 手势 / 移动端

### E1 `touch-action: none` + `user-scalable=no`
否则长按弹系统菜单、双击缩放。

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

## H. 布局调试方法论（实测有效）

### H1 数值化探测替代目测截图
注入探针脚本读 `getComputedStyle` + `offsetWidth` + `getBoundingClientRect` + 祖先 transform，多尺寸（320–1920）headless Chrome 验证。
**隔离复现不可信**：布局 bug 往往只在真实内容量级下触发（如 A4 百分比循环），必须用真实页面测。

### H2 三数值不一致 → 先查 transform/zoom（A1）；样式对但布局错 → 查 box-sizing（A2）

## I. wasm / MoonBit / 双环境（实测）

### I1 MoonBit 新版配置与内存导出（2026-08 实测）
- `moon.pkg.json` 即将移除，新格式 `moon.pkg`（`moon new` 生成；`pkgtype(kind: "foreign_library")`）。**两种格式并存会解析失败**——只留一种。
- DSL 里 link 配置键必须加引号：`options( "link": { "wasm": { "export-memory-name": "memory", ... } } )`——不引号会报 `BoolOrLink` 解析错；JSON 里 `memory-limits` 的 `min`/`max` 都要给。
- 经典 wasm 目标默认**不导出 memory**，JS 侧拿不到共享内存 → 必须 `export-memory-name`；暂存区与 MoonBit 堆冲突 → 用 `heap-start-address` 抬堆（低地址留给 JS 视图）。
- 顶层不能 `let mut` 全局可变 → 用 `Ref::Ref(None)`（`Ref::new` 已弃用）；Float 字面量要类型标注 `FixedArray::make(n, 0.0 : Float)`；f32↔f64 显式 `to_double()`/`to_float()`。
- `extern "wasm" fn f(addr: Int) -> Double = #|(func (param i32) (result f64) ...f32.load f64.promote_f32)`——返回类型必须与 MoonBit 声明一致。

### I2 bun 的 `WebAssembly.instantiate(bytes)` 返回空实例
**症状**：bun 里 `WebAssembly.instantiate(bytes)` 的返回值 `exports` 为 undefined、`instance` 为 `{}`；node 正常。
**修法**：bun 下用 `new WebAssembly.Instance(WebAssembly.compile(bytes), {})`（实测 JSC 可正常实例化并访问 exports）。

### I3 Node fetch 不支持 file://
**症状**：vitest（node 跑）里 `fetch(new URL('./x.wasm', import.meta.url))` 抛 "fetch failed"；bun 的 fetch 支持 file://。
**修法**：加载器按 `url.protocol === 'file:'` 分叉——node/bun 走 `import('node:fs/promises').readFile(url)`（src 配置无 node 类型时补最小 `declare module 'node:fs/promises'`），浏览器走 fetch；vite build 会把 node:fs 外部化（警告无害，浏览器分支不触达）。**别用 `?url` 导入**：vitest 里返回 dev-server 路径 `/src/x.wasm`，node fetch 不可用。

### I4 vite dev 只绑 IPv6 回环
**症状**：vite dev 起来了，`curl http://127.0.0.1:端口` 连接失败（000），`localhost` 正常。
**根因**：vite（新版本）只监听 `::1`。自动化脚本访问 dev server 一律用 `http://localhost:端口`。
**信号**：headless 自动化/curl 探测 127.0.0.1 失败但浏览器手开正常。

### I5 bun 的 node:child_process 兼容坑
- `spawn` 的 `stdio` 传 stream（createWriteStream 等）报 "TODO: stream.Readable stdio"；传 `Bun.file()` 报 "Invalid stdio option"。
- **修法**：脚本统一用原生 `Bun.spawn([cmd, ...args], { cwd, stdout: 'ignore', stderr: 'ignore' })`，cwd 必须显式（vite 从 cwd 找配置/根，cwd 错会 404）。
- `bunx` 会产生孙进程，kill 不掉会占端口——直接跑 `node_modules/xxx/bin/xxx.js`。

### I6 CDP 自动化零依赖可用
headless Chrome 加 `--remote-debugging-port` 后，用 bun 原生 `WebSocket` 直连 `http://127.0.0.1:PORT/json/version` 的 webSocketDebuggerUrl 即可驱动（Target.createTarget → Runtime.evaluate 轮询），无需 puppeteer/playwright。CPU 节流：`Emulation.setCPUThrottlingRate { rate }`（真实浏览器弱设备近似）。

### I7 wasm 求解器不是万能药：先测再定默认
**实测（2026-08）**：同负载下 MoonBit wasm 求解器 vs JS JIT——bun/JSC 持平（0.73 vs 0.66ms）、node/V8 慢 ~2.5×、headless Chrome 6× 节流时 wasm 9.2ms vs JS 4.4ms。**但无 JIT 的 iOS WKWebView 里 JS 数值循环慢 10~30×（13~45ms 掉帧），wasm 恒定编译速度（1.5~9ms）**。
**修法**：逐位一致的 wasm 双引擎 + 启动探测（与求解器同构小循环，≥2.5ms 判定弱引擎）+ 弱引擎才切 wasm；强引擎永远 JS——不牺牲任何现有体验。**判断 wasm 值不值前必须先跑基准**（scripts/bench.ts + bench.html），不要凭"wasm 必然快"的直觉。

### H3 Lit 3 样式在 `shadowRoot.adoptedStyleSheets`
无 `<style>` 标签，查生效规则读 `cssRules` 的 `cssText`。
