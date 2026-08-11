# 烧风（sfgame-web）

用温度差创造风：放置热源与冷源造风，让纸飞机乘风抵达旗帜。
Lit 3 + WebGL 渲染，AssemblyScript 编译的 WASM·SIMD 流体内核，vite 构建，bun 运行时。

## 运行

```sh
bun install
bun run dev       # vite 开发；插件自动编译 wasm 并监视 assembly/ 变更重编
bun run test      # build:wasm + vitest 单元测试
bun run check     # fail-fast 一键验证：typecheck → test → vite build
bun run build     # 产物到 dist/（相对路径部署，单 bundle）
bun run preview   # 预览产物
```

物理内核为 WASM·SIMD 唯一实现，不支持的环境启动时明示无法运行，绝不静默回退。

## 玩法

- 轻点放热源，长按（或右键）放冷源，点按已放源可移除；源有预算计数
- 风场 = 环境风（贴地绕流的位流基场 × 潮汐强度）+ 冷热源浮力风；示踪粒子可视化风
- 纸飞机自动起飞，只与空气和地面作用：地面是唯一边界，可飞出地图，飞失自担
- 抵达圆内滑行与飞行同等计数；零操作挂机不可通关（各关挂机轨迹不穿过抵达圆）
- 通关只记最佳总耗时（含源罚时/贴地罚时），与关卡内容 hash 绑定存 localStorage；解法不随关卡发布

## 结构

```
app/
  main.ts        入口：预热 WASM 内核后装配 UI
  core/          框架无关基础设施：固定步长循环、音效+震动反馈门面、性能治理、风强度与落地判定、URL 状态、BGM
  game/          无头关卡逻辑：模拟、SDF 地形表达式、关卡协议/加载/解锁、通关记录、计时、屏幕推导
  sim/           物理内核（无 DOM）：流体 WASM 门面、纸飞机质点、示踪粒子、拖尾、云、地形 SDF 采样
  render/        WebGL 渲染层：场景→顶点批组装（render.ts）、GL 薄层+程序化积云趟（gl.ts）、批门面（batch.ts）
  ui/            玩家界面：Lit 组件（标题/HUD/胜利/关于…）、控制器、手势输入
  dev/           开发者工具（?dev=1）：面板、性能块、关卡 JSON 编辑器
  wasm/          WASM 引擎引导与实例化（单实例单内存；产物 sfengine.wasm 不入库）
assembly/        AssemblyScript 源码：流体内核 + 顶点批内核 + 示踪粒子 tessellate，编译为同一引擎模块
levels/          关卡 JSON（level-1..20）+ schema
scripts/         关卡/求解器离线工具（run-level、solve-*、tune-scan）与 vite 插件（wasm 自动重编、schema 拷贝）
tests/           vitest 最小集（setup.ts 预热 WASM 内核）
```

## 架构不变量

- 分层：`core/`、`game/`、`sim/` 无 DOM 可无头测试；DOM 仅在 `ui/` 与 `dev/`；`render/batch.ts` 纯计算可无头测试
- 流体域 = 地图外扩边距 + sponge 吸收层；环境风预烘焙位流基场，采样时线性叠加，不进 step 流水线
- 地形 = SDF 表达式（`game/sdf.ts`）：物理采样与渲染 marching squares 切 d=0 等值线同源
- 渲染零拷贝直读流体场；主顶点批单 draw call，云为独立 GLSL 趟夹在两半之间（遮粒子与日芒、被地形遮）
- 云 = 风的被动示踪物：图内当地风、图外远场风平流，累积下降超限消散，出图销毁
- 纸飞机参数归口 `sim/bodies.ts`（全游戏唯一刚体）；HOVER_WIND = gravity/dragK 是唯一调参口径

## 关卡工具

```sh
bun run scripts/run-level.ts levels/level-N.json --verify --sim 60   # 无头跑关/挂机自查
bun run scripts/run-level.ts levels/level-N.json --solve            # 离线求解（产物不入库）
```

关卡协议见 `levels/level.schema-1.json`；设计与验证流程见 `../skills/level-design/SKILL.md`。

## 更多

- 开发守则与实现要点：`../docs/development.md`
- 避坑手册（症状→条目）：`../skills/pitfalls/SKILL.md`
- 仓库级约定：`../AGENTS.md`
