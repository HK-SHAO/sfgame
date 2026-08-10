import { expect, test } from 'vitest'
import schemaText from '../levels/level.schema.json?raw'
import { GOAL_R_MAX, LEVEL_SCHEMA, LIST_MAX, SWING_MAX, TEMP_LIMIT } from '../app/game/level-validate'
import { LEVEL_ERRORS, LEVELS } from '../app/game/levels'
import { validateLevelJson } from '../app/game/level-validate'

// schema 文件与运行时校验是协议的两份镜像实现（编辑器静态面 vs 运行时全量面），
// 关键边界必须一致——此处守护，防单侧漂移
interface JsonSchema {
  $id?: string
  $schema?: string
  type?: string
  const?: number
  description?: string
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  maxItems?: number
  minItems?: number
  required?: string[]
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
}

const schema = JSON.parse(schemaText) as JsonSchema
const prop = (p: string) => schema.properties![p]

test('schema 文件：draft-07、项目匹配 $id、根附加属性关闭、必需字段与协议一致', () => {
  expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#')
  expect(schema.$id).toMatch(/^https:\/\/raw\.githubusercontent\.com\/HK-SHAO\/sfgame\//)
  expect(schema.required).toEqual([
    'schema', 'id', 'name', 'tagline', 'win', 'world', 'terrain', 'budget', 'spawn', 'goals',
  ])
  expect(prop('schema').const).toBe(LEVEL_SCHEMA)
  expect(prop('$schema').type ?? '').toBe('string')
})

test('schema 静态边界与运行时校验常量镜像一致', () => {
  expect(prop('goals').items!.properties!.r.maximum).toBe(GOAL_R_MAX)
  expect(prop('fixed').maxItems).toBe(LIST_MAX)
  expect(prop('fans').maxItems).toBe(LIST_MAX)
  expect(prop('fans').items!.properties!.swing.maximum).toBeCloseTo(SWING_MAX)
  expect(prop('ambient').properties!.temp.minimum).toBe(-TEMP_LIMIT)
  expect(prop('ambient').properties!.temp.maximum).toBe(TEMP_LIMIT)
  expect(prop('budget').properties!.hot.type).toBe('integer')
})

test('仓库关卡：全部相对引用 schema 且通过运行时校验', () => {
  expect(LEVEL_ERRORS).toEqual([])
  for (const l of LEVELS) {
    expect(l.json.$schema).toBe('./level.schema.json')
    expect(validateLevelJson(l.json)).toEqual([])
  }
})

test('schema 描述只谈游戏设计，不含工程/代码内部信息', () => {
  const descs: string[] = []
  const walk = (n: JsonSchema) => {
    if (n.description !== undefined) descs.push(n.description)
    if (n.items) walk(n.items)
    if (n.properties) for (const p of Object.values(n.properties)) walk(p)
  }
  walk(schema)
  expect(descs.length).toBeGreaterThan(10)
  for (const d of descs) expect(d).not.toMatch(/(level-validate|levels\.ts|skills\/|app\/|运行时|校验强制)/)
})
