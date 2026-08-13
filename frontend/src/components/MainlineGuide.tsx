import { useEffect, useRef } from 'react'

type Props = {
  open: boolean
  onClose: () => void
}

const FOCUSABLE_SELECTOR = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

export function MainlineGuide({ open, onClose }: Props) {
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!open) return

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    dialog?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialog) return

      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus()
    }
  }, [onClose, open])

  if (!open) return null

  return (
    <div className="mainline-guide-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={dialogRef} className="mainline-guide" role="dialog" aria-modal="true" aria-labelledby="mainline-guide-title">
        <button type="button" className="mainline-guide-close" onClick={onClose} aria-label="Close Mainline guide">×</button>
        <div className="mainline-guide-heading">
          <svg className="app-logo" viewBox="0 0 64 64" aria-hidden="true">
            <path className="app-logo-rook" d="M8 9h12v9h7V9h10v9h7V9h12v17l-6 6v15l5 5v4H9v-4l5-5V32l-6-6V9Z" />
            <path className="app-logo-line" d="M29 21h6v15.5l7-6h3v3.5l-10 8v9h-6v-9l-10-8v-3.5h3l7 6V21Z" />
          </svg>
          <div>
            <h2 id="mainline-guide-title">Welcome to Mainline</h2>
            <p>Explore openings, build your repertoire, and practice the lines you want to remember.</p>
          </div>
        </div>
        <ol className="mainline-guide-steps">
          <li><strong>Explore</strong><span>Play moves on the board to see common replies, opening statistics, and engine analysis.</span></li>
          <li><strong>Build</strong><span>Save the moves you want to play and organize them into opening modules for White and Black.</span></li>
          <li><strong>Drill</strong><span>Practice your repertoire from memory and get feedback when you stray from your prepared lines.</span></li>
        </ol>
        <p className="mainline-guide-return">You can open this guide again anytime by selecting the Mainline logo.</p>
        <button type="button" className="mainline-guide-start" onClick={onClose}>Get started</button>
      </section>
    </div>
  )
}
