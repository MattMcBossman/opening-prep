import { useEffect, useRef, useState } from 'react'

type ExplorerSection = 'moves' | 'stats' | 'prep'

type Props = {
  open: boolean
  onClose: () => void
  onWalkthroughSectionChange: (section: ExplorerSection) => void
  onWalkthroughModeChange: (mode: 'explorer' | 'drill') => void
}

type WalkthroughStep = {
  target: string
  eyebrow: string
  title: string
  description: string
  section?: ExplorerSection
  mode?: 'explorer' | 'drill'
}

const FOCUSABLE_SELECTOR = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    target: '[data-guide="modes"]',
    eyebrow: 'Navigate',
    title: 'Explore or practice',
    description: 'Use these tabs to browse openings and build lines in Explorer, or switch to Drills to practice your saved repertoire.',
    mode: 'explorer',
  },
  {
    target: '.board-with-eval',
    eyebrow: 'Explore',
    title: 'Play moves on the board',
    description: 'Drag a piece or tap its starting and destination squares. The opening name, evaluation, moves, and statistics update with the position.',
  },
  {
    target: '#mobile-moves-panel > h2',
    eyebrow: 'Build',
    title: 'Review and save moves',
    description: 'This is the line you have played. Select an earlier move to go back, and use stars on your own moves while editing a module to save your repertoire.',
    section: 'moves',
  },
  {
    target: '#mobile-stats-panel .explorer-toolbar',
    eyebrow: 'Research',
    title: 'See what players choose',
    description: 'Opening statistics show popular continuations and results. Select a move in the table to play it on the board.',
    section: 'stats',
  },
  {
    target: '#mobile-prep-panel .coverage-dashboard > h3',
    eyebrow: 'Prepare',
    title: 'Find gaps in your repertoire',
    description: 'Preparation tools summarize coverage and help you spot common opponent replies that still need an answer.',
    section: 'prep',
  },
  {
    target: '[data-guide="modes"]',
    eyebrow: 'Practice',
    title: 'Switch to Drills',
    description: 'Drills hide opening hints and ask you to recall the moves saved in your repertoire. Use the Drills tab whenever you want to practice.',
    mode: 'drill',
  },
  {
    target: '.drill-progress, .drill-empty',
    eyebrow: 'Drill',
    title: 'Practice one line at a time',
    description: 'Choose a starting point, then play your prepared moves from memory. Mainline tracks progress, explains wrong moves, and lets you retry failed lines. If this area is empty, save some Explorer moves first.',
    mode: 'drill',
  },
  {
    target: '[data-guide="brand"]',
    eyebrow: 'You’re ready',
    title: 'Come back anytime',
    description: 'Select the Mainline logo whenever you want to reopen this welcome and take the walkthrough again.',
    mode: 'explorer',
  },
]

export function MainlineGuide({ open, onClose, onWalkthroughSectionChange, onWalkthroughModeChange }: Props) {
  const dialogRef = useRef<HTMLElement>(null)
  const [stepIndex, setStepIndex] = useState<number | null>(null)
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
  const isWalkthrough = stepIndex !== null
  const step = isWalkthrough ? WALKTHROUGH_STEPS[stepIndex] : null

  useEffect(() => {
    if (!open) setStepIndex(null)
  }, [open])

  useEffect(() => {
    if (!open || isWalkthrough) return

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
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
      document.body.style.overflow = previousBodyOverflow
      previousFocus?.focus()
    }
  }, [isWalkthrough, onClose, open])

  useEffect(() => {
    if (!open || !step) return
    if (step.mode) onWalkthroughModeChange(step.mode)
    if (step.section) onWalkthroughSectionChange(step.section)

    let frame = 0
    const updateTargetRect = () => {
      const target = document.querySelector<HTMLElement>(step.target)
      if (!target) return
      frame = window.requestAnimationFrame(() => setTargetRect(target.getBoundingClientRect()))
    }
    const timer = window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(step.target)
      target?.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' })
      window.scrollBy({ top: -72, behavior: 'smooth' })
      updateTargetRect()
    }, 80)
    window.addEventListener('resize', updateTargetRect)
    window.addEventListener('scroll', updateTargetRect, true)
    return () => {
      window.clearTimeout(timer)
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updateTargetRect)
      window.removeEventListener('scroll', updateTargetRect, true)
    }
  }, [onWalkthroughModeChange, onWalkthroughSectionChange, open, step])

  useEffect(() => {
    if (!open || !isWalkthrough) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isWalkthrough, onClose, open])

  if (!open) return null

  if (step) {
    const currentStepIndex = stepIndex ?? 0
    const isLast = currentStepIndex === WALKTHROUGH_STEPS.length - 1
    const spotlight = targetRect ? {
      left: Math.max(6, targetRect.left - 6),
      top: Math.max(6, targetRect.top - 6),
      right: Math.min(window.innerWidth - 6, targetRect.right + 6),
      bottom: Math.min(window.innerHeight - 6, targetRect.bottom + 6),
    } : null
    const placeCardAtTop = spotlight !== null && spotlight.top > window.innerHeight / 2
    return (
      <div className="walkthrough-layer" role="dialog" aria-modal="true" aria-labelledby="walkthrough-title">
        {spotlight && (
          <div
            className="walkthrough-spotlight"
            style={{
              left: spotlight.left,
              top: spotlight.top,
              width: Math.max(0, spotlight.right - spotlight.left),
              height: Math.max(0, spotlight.bottom - spotlight.top),
            }}
          />
        )}
        <section className={`walkthrough-card${placeCardAtTop ? ' walkthrough-card-top' : ''}`}>
          <button type="button" className="mainline-guide-close" onClick={onClose} aria-label="Close walkthrough">×</button>
          <span className="walkthrough-progress">{currentStepIndex + 1} of {WALKTHROUGH_STEPS.length}</span>
          <span className="walkthrough-eyebrow">{step.eyebrow}</span>
          <h2 id="walkthrough-title">{step.title}</h2>
          <p>{step.description}</p>
          <div className="walkthrough-actions">
            {currentStepIndex > 0 && <button type="button" className="mainline-guide-secondary" onClick={() => setStepIndex(currentStepIndex - 1)}>Back</button>}
            <button type="button" className="mainline-guide-start" onClick={() => isLast ? onClose() : setStepIndex(currentStepIndex + 1)}>
              {isLast ? 'Finish' : 'Next'}
            </button>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="mainline-guide-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={dialogRef} className="mainline-guide" role="dialog" aria-modal="true" aria-labelledby="mainline-guide-title">
        <button type="button" className="mainline-guide-close" onClick={onClose} aria-label="Close Mainline guide">×</button>
        <div className="mainline-guide-heading">
          <svg className="app-logo" viewBox="0 0 64 64" aria-hidden="true">
            <path className="app-logo-rook" d="M8 9h12v9h7V9h10v9h7V9h12v17l-6 6v15l5 5v4H9v-4l5-5V32l-6-6V9Z" />
            <path className="app-logo-line" d="M29 21h6v35h-6V21Zm-9.5 6h4v7l5.5 5v5l-9.5-8v-9Zm25 4h-4v7L35 43v5l9.5-8v-9Z" />
          </svg>
          <div>
            <h2 id="mainline-guide-title">Welcome to Mainline</h2>
            <p>Explore openings, build your repertoire, and practice the lines you want to remember.</p>
          </div>
        </div>
        <ol className="mainline-guide-steps">
          <li><strong>Explore</strong><span>Play moves on the board to see common replies, opening statistics, and engine analysis.</span></li>
          <li><strong>Build</strong><span>Save the opening lines you want to prepare for White and Black.</span></li>
          <li><strong>Drill</strong><span>Practice your repertoire from memory and get feedback when you stray from your prepared lines.</span></li>
        </ol>
        <p className="mainline-guide-return">You can reopen this guide anytime by selecting the Mainline logo.</p>
        <div className="mainline-guide-actions">
          <button type="button" className="mainline-guide-secondary" onClick={onClose}>Jump right in</button>
          <button type="button" className="mainline-guide-start" onClick={() => setStepIndex(0)}>Start walkthrough</button>
        </div>
      </section>
    </div>
  )
}
