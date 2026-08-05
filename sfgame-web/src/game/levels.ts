import { levelFromJson, parseLevelText } from './level-format'
import type { LevelDef } from './types'
// YAML 作为纯文本经 ?raw 直读（vite 原生支持、随文件变更触发 HMR），
// 解析在运行时统一走 parseLevelText——不再需要虚拟模块/构建插件
import level1 from '../../levels/level-1.yaml?raw'
import level2 from '../../levels/level-2.yaml?raw'
import level3 from '../../levels/level-3.yaml?raw'
import level4 from '../../levels/level-4.yaml?raw'
import level5 from '../../levels/level-5.yaml?raw'

/**
 * 关卡清单：全部来自 levels/*.yaml（协议 v1，表达式地形）。
 * 新关卡 = 新增一个 YAML 文件并在下方登记一行 import——模拟/渲染/URL/解法参考页自动生效。
 * 前两关为教学热身（升、降），后三关为 #10 新增的教学关（多站之旅、潮汐、三站之旅）。
 */
const LEVEL_TEXTS = [level1, level2, level3, level4, level5]

export const LEVELS: LevelDef[] = LEVEL_TEXTS.map((text) => levelFromJson(parseLevelText(text)))

/** 命名导出兼容（老测试/基准脚本按名字引用前两关）。 */
export const LEVEL_1 = LEVELS[0]
export const LEVEL_2 = LEVELS[1]
