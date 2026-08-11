// 键盘输入通道：与 input.ts（pointer 手势层）并列的输入层，按键知识单模块内聚。
// 职责链 = window 监听 → enabled 守卫 → target 过滤 → 键位映射 → 回调派发；app.ts 只注册语义动作。
export interface KeyHandlers {
  pause(): void
  speedDown(): void
  speedUp(): void
  restart(): void
  mute(): void
  back(): void
  undo(): void
  redo(): void
}

// 排除输入语境：dev 编辑器打字、按钮上的 Space 激活（keyup 双触发）都会误派发
const IGNORE_TAGS = new Set(['INPUT', 'TEXTAREA', 'BUTTON'])

export function setupKeys(handlers: KeyHandlers, isEnabled: () => boolean): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (!isEnabled()) return
    const target = e.target as HTMLElement | null
    if (target !== null && IGNORE_TAGS.has(target.tagName)) return
    // IME 组合中按键是"输入文字"语义（key 为 Process），不触发游戏动作；待输入态物理键正常响应
    if (e.isComposing) return
    const mod = e.ctrlKey || e.metaKey
    // 物理键判定（e.code）：与 IME/键盘布局无关——非英文输入法下 key 可能是 Process 或候选翻页被拦截，code 恒可用
    const code = e.code
    if (mod) {
      // 修饰键组合：仅撤销/重做；alt 留给系统级组合
      if (!e.altKey) {
        if (code === 'KeyZ' && !e.shiftKey) handlers.undo()
        else if (code === 'KeyZ' && e.shiftKey) handlers.redo()
        else if (code === 'KeyY') handlers.redo()
      }
      return
    }
    switch (code) {
      case 'Escape':
        handlers.back()
        break
      case 'Space':
      case 'KeyP':
        handlers.pause()
        break
      case 'KeyR':
        handlers.restart()
        break
      case 'KeyM':
        handlers.mute()
        break
      case 'BracketLeft':
        handlers.speedDown()
        break
      case 'BracketRight':
        handlers.speedUp()
        break
    }
  }
  window.addEventListener('keydown', onKeyDown)
  return () => window.removeEventListener('keydown', onKeyDown)
}
