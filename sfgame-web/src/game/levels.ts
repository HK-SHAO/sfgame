import { levelFromJson, parseLevelText } from './level-format'
import type { LevelDef } from './types'
import { LEVEL_TEXTS } from 'virtual:levels'

/**
 * 关卡清单：全部来自 levels/*.yaml（协议 v1，表达式地形）。
 * 新关卡 = 新增一个 YAML 文件并在下方登记一行——模拟/渲染/URL/解法参考页自动生效。
 * 前两关为教学热身（升、降），后三关为 #10 新增的教学关（站点序列、潮汐、三站之旅）。
 */
export const LEVELS: LevelDef[] = ['level-1.yaml', 'level-2.yaml', 'level-3.yaml', 'level-4.yaml', 'level-5.yaml'].map((f) =>
  levelFromJson(parseLevelText(LEVEL_TEXTS[f])),
)

/** 命名导出兼容（老测试/基准脚本按名字引用前两关）。 */
export const LEVEL_1 = LEVELS[0]
export const LEVEL_2 = LEVELS[1]
