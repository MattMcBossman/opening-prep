export type ExplorerSection = 'moves' | 'stats' | 'prep'

export type WalkthroughStep = {
  target: string
  eyebrow: string
  title: string
  description: string
  section?: ExplorerSection
  mode?: 'explorer' | 'drill'
}

export const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  { target: '[data-guide="modes"]', eyebrow: 'Navigate', title: 'Explore or practice', description: 'Use these tabs to browse openings and build lines in Explorer, or switch to Drills to practice your saved repertoire.', mode: 'explorer' },
  { target: '.board-with-eval', eyebrow: 'Explore', title: 'Play moves on the board', description: 'Make a move on the board. The opening name, evaluation, moves, and statistics update with the position.' },
  { target: '#mobile-moves-panel > h2', eyebrow: 'Build', title: 'Review and save moves', description: 'This is the line you have played. Select an earlier move to go back, and use stars on your own moves while editing a module to save your repertoire.', section: 'moves' },
  { target: '#mobile-stats-panel .explorer-toolbar', eyebrow: 'Research', title: 'See what players choose', description: 'Opening statistics show popular continuations and results. Select a move in the table to play it on the board.', section: 'stats' },
  { target: '#mobile-prep-panel .coverage-dashboard > h3', eyebrow: 'Experimental', title: 'Find gaps in your repertoire', description: 'Experimental coverage tools summarize preparation and help you spot common opponent replies that still need an answer.', section: 'prep' },
  { target: '#mobile-prep-panel .opening-generator-heading', eyebrow: 'Experimental', title: 'Generate a recommended tree', description: 'Experimental tree recommendations can build a practical repertoire from the position currently shown on the board.', section: 'prep' },
  { target: '[data-guide="modes"]', eyebrow: 'Practice', title: 'Switch to Drills', description: 'Drills hide opening hints and ask you to recall the moves saved in your repertoire. Use the Drills tab whenever you want to practice.', mode: 'drill' },
  { target: '.drill-progress, .drill-empty', eyebrow: 'Drill', title: 'Practice one line at a time', description: 'Choose a starting point, then play your prepared moves from memory. Mainline tracks progress, explains wrong moves, and lets you retry failed lines. Experimental analysis appears after a completed line. If this area is empty, save some Explorer moves first.', mode: 'drill' },
  { target: '[data-guide="modes"]', eyebrow: 'Alpha', title: 'A repertoire to get you started', description: 'The Vienna Game opening module is loaded by default for this alpha deployment. Have fun, Kurtis.', mode: 'explorer' },
  { target: '[data-guide="brand"]', eyebrow: 'You’re ready', title: 'Come back anytime', description: 'Select the Mainline logo whenever you want to reopen this welcome and take the walkthrough again.', mode: 'explorer' },
]

export function walkthroughSpotlightBounds(
  target: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>,
  viewportWidth: number,
  viewportHeight: number,
  mobile: boolean,
) {
  const viewportInset = mobile ? 0 : 6
  return {
    left: Math.max(viewportInset, target.left - 6),
    top: Math.max(viewportInset, target.top - 6),
    right: Math.min(viewportWidth - viewportInset, target.right + 6),
    bottom: Math.min(viewportHeight - viewportInset, target.bottom + 6),
  }
}
