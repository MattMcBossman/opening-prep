import { useEffect } from 'react'

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.closest('[role="dialog"]') !== null
    || target.isContentEditable
    || target.tagName === 'INPUT'
    || target.tagName === 'TEXTAREA'
    || target.tagName === 'SELECT'
}

/** Binds a bare R key to the active board's reset/restart action. */
export function useResetKeyboardShortcut(onReset: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== 'r') return
      // Preserve browser refresh (Ctrl/Cmd+R), shortcuts, and typed text.
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (isTextEntryTarget(event.target)) return
      event.preventDefault()
      onReset()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled, onReset])
}
