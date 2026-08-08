import { useEffect } from 'react'

/**
 * Whether the key event came from somewhere the arrow keys already mean something
 * else - a text field's caret, a select's options, or rich-text editing. The
 * listener is on `window` (so the board doesn't have to be focused for the keys to
 * work), which means it would otherwise hijack arrow keys while the user is editing
 * the Lichess token input.
 */
function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}

/**
 * Binds ArrowLeft/ArrowRight to the explorer's Back/Forward controls, so a line can
 * be stepped through from the keyboard the same way it can with the buttons.
 *
 * `enabled` scopes this to the view that actually has move history: drills walk a
 * prepared line and have no back/forward of their own, so the keys stay inert there
 * rather than silently navigating a hidden explorer position.
 */
export function useHistoryKeyboardNav(onBack: () => void, onForward: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      // Modified presses belong to the browser/OS (Alt+Left is "back a page") or to
      // text selection - only a bare arrow key means "step through the line".
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (isTextEntryTarget(event.target)) return

      // Otherwise the page also scrolls horizontally on each press.
      event.preventDefault()
      if (event.key === 'ArrowLeft') {
        onBack()
      } else {
        onForward()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onBack, onForward, enabled])
}
