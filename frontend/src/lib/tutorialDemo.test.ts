import { describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import { normalizeFen } from './chessUtils'
import { TUTORIAL_LICHESS_STATS, TUTORIAL_USER, TUTORIAL_VIENNA_TREE } from './tutorialDemo'

describe('tutorial demo data', () => {
  it('shows a saved e4 Vienna tree with realistic opponent branches', () => {
    const board = new Chess()
    const root = normalizeFen(board.fen())
    expect(TUTORIAL_VIENNA_TREE[root].map((move) => move.uci)).toEqual(['e2e4'])
    board.move('e4'); board.move('e5'); board.move('Nc3')
    expect(TUTORIAL_VIENNA_TREE[normalizeFen(board.fen())].map((move) => move.uci)).toEqual([
      'g8f6', 'f8c5', 'b8c6',
    ])
  })

  it('provides a consistent public-Lichess sample', () => {
    expect(TUTORIAL_USER.lichessUsername).toBeTruthy()
    expect(TUTORIAL_LICHESS_STATS.moves[0]).toMatchObject({ san: 'e4', uci: 'e2e4' })
    expect(TUTORIAL_LICHESS_STATS.moves.reduce((sum, move) => sum + move.totalGames, 0)).toBe(
      TUTORIAL_LICHESS_STATS.totalGames,
    )
  })
})
