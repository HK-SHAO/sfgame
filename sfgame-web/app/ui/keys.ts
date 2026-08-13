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
    if (e.isComposing) return
    const mod = e.ctrlKey || e.metaKey
    const code = e.code
    if (mod) {
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
