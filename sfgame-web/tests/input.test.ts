import { expect, test } from 'vitest'
import { buttonKind } from '../app/ui/input.ts'

// 右键 = 放冷源是玩法不变量（AGENTS.md）：按钮判定抽为纯函数后可无头守护，
// 此前 input.ts 无任何测试覆盖（DOM 层无法进 node 测试）
test('按钮→源种类：左键热、右键冷、其余不响应', () => {
  expect(buttonKind(0)).toBe('hot')
  expect(buttonKind(2)).toBe('cold')
  expect(buttonKind(1)).toBeNull()
  expect(buttonKind(3)).toBeNull()
})
