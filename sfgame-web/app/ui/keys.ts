// 键盘输入通道：与 input.ts（pointer 手势层）并列的输入层，按键知识单模块内聚。
// 职责链 = window 监听 → target 过滤 → 键位映射 → 回调派发；app.ts 只注册语义动作。
// 全局键（返回/撤销/重做 = 浏览器历史导航语义）全 app 生效；游戏控制键仅关卡屏（isGameScreen 守卫）。
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

// 编辑语境一律不响应：dev 编辑器打字、按钮上的 Space 激活（keyup 双触发）都会误派发；
// 文本框内的 Ctrl+Z/Y 由浏览器原生文本撤销处理，页面级不拦截——输入优先级高于页面导航。
// 判定用 composedPath 起点而非 e.target：shadow 内事件在 window 层可能被重定向成 host 元素，tagName 判定会失配
function isEditOrigin(e: KeyboardEvent): boolean {
  const origin = e.composedPath()[0]
  if (!(origin instanceof Element)) return false
  const tag = origin.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'BUTTON' ||
    (origin instanceof HTMLElement && origin.isContentEditable)
  )
}

export function setupKeys(handlers: KeyHandlers, isGameScreen: () => boolean): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (isEditOrigin(e)) return
    // IME 组合中按键是"输入文字"语义（key 为 Process），不触发游戏动作；待输入态物理键正常响应
    if (e.isComposing) return
    const mod = e.ctrlKey || e.metaKey
    // 物理键判定（e.code）：与 IME/键盘布局无关——非英文输入法下 key 可能是 Process 或候选翻页被拦截，code 恒可用
    const code = e.code
    if (mod) {
      // 修饰键组合：仅撤销/重做（全局）；alt 留给系统级组合
      if (!e.altKey) {
        if (code === 'KeyZ' && !e.shiftKey) handlers.undo()
        else if (code === 'KeyZ' && e.shiftKey) handlers.redo()
        else if (code === 'KeyY') handlers.redo()
      }
      return
    }
    if (code === 'Escape') {
      handlers.back()
      return
    }
    if (!isGameScreen()) return
    switch (code) {
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
