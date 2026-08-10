import { validateLevelJson } from './level-validate'
import { compileSdf } from './sdf'
import type { LevelDef, LevelJson } from './types'

// 校验通过才出 LevelJson；解析失败与校验失败分道报错（各自定位准确）
function requireValid(raw: unknown): LevelJson {
  const errs = validateLevelJson(raw)
  if (errs.length > 0) throw new Error(`关卡校验失败：\n${errs.join('\n')}`)
  return raw as LevelJson
}

export function parseLevelText(text: string): LevelJson {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new Error(`关卡 JSON 解析失败：${e instanceof Error ? e.message : String(e)}`)
  }
  return requireValid(raw)
}

// validated = 调用方已走 parseLevelText/validateLevelJson（内置关卡加载路径），跳过重复校验；
// 外部输入（内联关卡 JSON、测试对象字面量）不传——校验是安全边界
export function levelFromJson(j: LevelJson, validated = false): LevelDef {
  if (!validated) requireValid(j)
  const f = compileSdf(j.terrain.sdf)
  return { ...j, sdf: f, fixed: j.fixed ?? [], fans: j.fans ?? [], json: j }
}
