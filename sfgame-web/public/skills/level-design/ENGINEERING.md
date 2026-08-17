# 关卡工程补充（工具链与登记）

工程源代码：https://github.com/HK-SHAO/sfgame

SKILL.md 的补充：只含创作之外的工程信息。新手创作只读 SKILL.md 即可；本文件供验证、调试与登记关卡时查阅。

## 文件与协议位置

- 关卡：`sfgame-web/levels/level-N.json`（N = 顺序号，文件名与 id 无耦合）
- 协议：`sfgame-web/levels/level.schema.json`（JSON Schema draft-07；`$schema` 绝对 URL 指向线上部署地址，dist 根随包发布副本）
- 校验双轨：schema 只表达静态约束（编辑器提示用）；**运行时校验以 `app/game/level-validate.ts` 为准**（world 依赖的动态边界 x≤w、网格容量、SDF 语义、固/气约束只在此），静态镜像由 `tests/level-schema.test.ts` 守护、行为面（含固/气）由 `tests/level-format.test.ts` 守护。`$schema` 值本身不校验（错版/缺失不拒绝关卡）。

## 校验口径补充（运行时才有）

- 网格容量：`(w+20)/cell ∈ [16,256]`、`(h+10)/cell ∈ [16,160]`（外扩边距 10：左/右/上，与 `terrainDims` 同公式）
- 出生点可出画布 ±20；goals/fixed/fans 须在世界内（x∈[0,w]，y∈(0,h]）
- `goals[].y` / `spawn.y` 缺省 = 该 x 处地表（`surfaceY`），洞穴内必须显式
- 固/气约束：世界内必须有空气（全实体拒绝）；**无实体（纯空域）允许**——2026-08 起不要求有着地点，飞机可全靠风场飞行
- 数值全须有限；顶层未知字段拒绝；budget 非负整数；fixed/fans 各 ≤8；swing ≤π

## 无头验证（bun 运行，物理内核恒为 WASM·Moonbit，无 JS 后端）

```bash
cd sfgame-web
# 挂机红线：150s 无操作，必须不通关（确定性，单样本即够；调参/remix 后必须重跑）
bun run scripts/run-level.ts levels/level-N.json --sim 150
# 可解性精验（解格式 = x-y-kind，如 20-29.3-h；与 URL s= 参数同构）
bun run scripts/run-level.ts levels/level-N.json --verify 20-29.3-h,50-21.3-h
# 解法搜索：多目标 GA（必须通关 → 总耗时最短）；--kinds h 只搜热源；--solve-cap 90
bun run scripts/run-level.ts levels/level-N.json --solve --kinds h
# 解精炼：以已知解为种子坐标下降（--refine-cap/--refine-ms 限预算）；种子格式同 --verify
bun run scripts/run-level.ts levels/level-N.json --refine 20-29.3-h
# 全量已知解回归（改物理/关卡后跑，应全通关）
bun run scripts/run-level.ts levels/level-N.json --verify-known
# 参数扫描（挂机对 temp/风扇功率非单调，破坏挂机须全档验证）
bun run scripts/tune-scan.ts levels/level-N.json
```

**求解口径**：只用精筛 dt=1/60（粗筛 dt=1/30 是另一套物理，已知解都可能假阴性）；候选坐标一律 1 位小数（URL 可放置，刀刃解直接淘汰）；总耗时 = 通关时间 + 源罚 4s/个 + 贴地罚 1s/s（同 `app/game/timer.ts`），路程不参与；鲁棒性 ≥75%（6/8）才算宽容好上手。粗筛胜点、时序依赖解（实局飞行中放源）在无头下复现不了——以精筛为准。

## 解法登记与回归

`scripts/known-solutions.ts`：全部关卡的已知解（dt=1/60 精验、1 位小数、总耗时为精筛实测）。**gui-xu（L20 归墟）尚未登记**（GA 未收敛，`--budget-ms` 300000 卡在 ~19 进展）——`--verify-known` 只覆盖已登记 19 关，补登需先求解收敛。

## 新关卡登记流程

1. 新建 `sfgame-web/levels/level-N.json`（不含解法）
2. `app/game/levels.ts`：顶部 `?raw` 导入 + `LEVEL_TEXTS` 一行 + `LEVEL_GROUPS` 组内 id（组名/顺序/解锁在此声明；第 4 组「罡风」= L16-20）
3. 同步 `tests/level-format.test.ts` 的 id/组枚举断言
4. 走完 SKILL.md §8 验收清单 + 本文件验证命令
5. 解登记进 `scripts/known-solutions.ts`（回归基线 + 后续 --refine 种子）
6. 选关页与 URL 直达自动生效，无额外 UI 改动

## URL 形态

- `?lv=N`（顺序号）/ `?lv=slug`（id）/ `?lv=<base64url JSON>`（内联 DIY 关卡；判别 = 先 slug 后 JSON，见 `app/game/state.ts`）
- `?s=x-y-kind_x-y-kind…`：直达解（1 位小数、整数去 .0，编码与 `known-solutions.ts` 的 `solutionUrl()` 同构）
