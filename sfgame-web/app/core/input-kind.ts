// 按键→源种类（玩法不变量：左键热、右键冷走 contextmenu）。无 DOM 纯函数——
// 放 core 层供无头测试守护（AGENTS.md：tests 只 import 无 DOM 面，ui/input.ts 的 DOM 事件类不得进测试图）
export function buttonKind(button: number): 'hot' | 'cold' | null {
  if (button === 0) return 'hot'
  if (button === 2) return 'cold'
  return null
}
