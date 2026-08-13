import { expect, test } from 'vitest'
import { buttonKind } from '../app/core/input-kind.ts'

// 右键 = 放冷源是玩法不变量（AGENTS.md）：按钮判定抽为无 DOM 纯函数后可无头守护
test('按钮→源种类：左键热、右键冷、其余不响应', () => {
  expect(buttonKind(0)).toBe('hot')
  expect(buttonKind(2)).toBe('cold')
  expect(buttonKind(1)).toBeNull()
  expect(buttonKind(3)).toBeNull()
})
