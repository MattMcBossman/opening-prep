export type ExplorerSection = 'moves' | 'stats' | 'prep'

export type WalkthroughStep = {
  target: string
  eyebrow: string
  title: string
  description: string
  section?: ExplorerSection
  mode?: 'explorer' | 'drill'
  source?: 'lichess' | 'my-games'
  manager?: 'modules'
}

export const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  { target: '[data-guide="modes"]', eyebrow: 'Navigate', title: 'Explore or practice', description: 'Use the Explorer to browse openings and build lines, or switch to Drills to practice your saved repertoire.', mode: 'explorer' },
  { target: '[data-guide="board"]', eyebrow: 'Explore', title: 'Play moves on the board', description: 'Make a move on the board. The opening name, evaluation, moves, and statistics update with the position.', mode: 'explorer' },
  { target: '#mobile-moves-panel', eyebrow: 'Build', title: 'View and edit saved lines', description: 'Review the lines saved in your selected opening module. Select any move to explore that position, or choose Edit to add, replace, and remove prepared lines.', section: 'moves', mode: 'explorer' },
  { target: '#mobile-stats-panel', eyebrow: 'Research', title: 'See what players choose', description: 'Link a Lichess account to see opening statistics, popular continuations, and results for each position.', section: 'stats', mode: 'explorer', source: 'lichess' },
  { target: '#mobile-stats-panel', eyebrow: 'Personal', title: 'Review your own games', description: 'Link a Lichess or Chess.com account to review your own game history.', section: 'stats', mode: 'explorer', source: 'my-games' },
  { target: '[data-guide="coverage"]', eyebrow: 'Experimental', title: 'Find gaps in your repertoire', description: 'Experimental coverage analysis summarizes your preparation and helps you identify gaps in your repertoire.', section: 'prep', mode: 'explorer', source: 'lichess' },
  { target: '[data-guide="opening-generator"]', eyebrow: 'Experimental', title: 'Generate a recommended tree', description: 'Experimental tree recommendations can suggest moves and build a practical repertoire from the selected position.', section: 'prep', mode: 'explorer' },
  { target: '[data-guide="modes"]', eyebrow: 'Practice', title: 'Switch to Drills', description: 'Use Drills to practice the moves in your saved repertoire from memory.', mode: 'drill' },
  { target: '[data-guide="drill-workspace"]', eyebrow: 'Drill', title: 'Practice one line at a time', description: 'Choose a starting point, then play your prepared moves from memory. Mainline tracks progress, explains wrong moves, and lets you retry failed lines. Experimental positional analysis appears at the end of each drill.', mode: 'drill' },
  { target: '[data-guide="walkthrough-vienna-module"]', eyebrow: 'Alpha', title: 'A repertoire to get you started', description: 'The Vienna Game opening module is loaded by default for this alpha deployment. Have fun, Kurtis.', mode: 'explorer', manager: 'modules' },
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
