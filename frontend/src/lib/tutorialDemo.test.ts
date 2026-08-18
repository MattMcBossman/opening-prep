import { describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import { tutorialPersonalGameStats, tutorialPositionStats, TUTORIAL_VIENNA_TREE } from './tutorialDemo'
import { normalizeFen } from './chessUtils'

describe('walkthrough position data', () => {
  it('follows a six-ply Vienna Gambit line with saved moves and changing stats', () => {
    const board = new Chess()
    const line = ['e2e4', 'e7e5', 'b1c3', 'g8f6', 'f2f4', 'd7d5']

    for (const uci of line) {
      const fen = normalizeFen(board.fen())
      const savedMoves = TUTORIAL_VIENNA_TREE[fen] ?? []
      const stats = tutorialPositionStats(fen)
      expect(TUTORIAL_VIENNA_TREE[fen]?.some((move) => move.uci === uci)).toBe(true)
      expect(stats.moves.some((move) => move.uci === uci)).toBe(true)
      expect(stats.moves.length).toBeGreaterThan(savedMoves.length)
      expect(stats.moves.some((move) => !savedMoves.some((saved) => saved.uci === move.uci))).toBe(true)
      board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4) })
    }

    expect(tutorialPositionStats(board.fen()).opening?.name).toBe('Vienna Game')
  })

  it('provides a small fictional personal-game sample distinct from public totals', () => {
    const board = new Chess()
    for (const uci of ['e2e4', 'e7e5', 'b1c3']) board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4) })

    const personal = tutorialPersonalGameStats(board.fen())
    const publicStats = tutorialPositionStats(board.fen())

    expect(personal.totalGames).toBeGreaterThan(0)
    expect(personal.totalGames).toBeLessThan(100)
    expect(personal.totalGames).not.toBe(publicStats.totalGames)
    expect(personal.moves.every((move) => move.totalGames < 25)).toBe(true)
  })
})
