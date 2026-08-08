import { describe, expect, it } from 'vitest'
import { denormalizeFen, formatMoveList, formatMoveListFromPly } from './chessUtils'

describe('denormalizeFen', () => {
  it('restores the move counters a normalized FEN dropped, from a ply count', () => {
    // 4 plies played = both sides have made 2 moves, so it's White to move on move 3.
    expect(denormalizeFen('8/8/8/8/8/8/8/8 w - -', 4)).toBe('8/8/8/8/8/8/8/8 w - - 0 3')
    // 5 plies played = White has also made its 3rd move, so it's Black to move on move 3.
    expect(denormalizeFen('8/8/8/8/8/8/8/8 b - -', 5)).toBe('8/8/8/8/8/8/8/8 b - - 0 3')
  })

  it('leaves an already-complete FEN untouched', () => {
    const fen = '8/8/8/8/8/8/8/8 w - - 7 15'
    expect(denormalizeFen(fen, 4)).toBe(fen)
  })
})

describe('formatMoveListFromPly', () => {
  it('numbers a line starting on White', () => {
    expect(formatMoveListFromPly(0, ['e4', 'e5', 'Nf3'])).toBe('1. e4 e5 2. Nf3')
  })

  it('numbers a line starting on Black, disambiguating the first move with "..."', () => {
    expect(formatMoveListFromPly(1, ['e5', 'Nf3', 'Nc6'])).toBe('1...e5 2. Nf3 Nc6')
  })

  it('continues from a deep, non-zero ply count correctly', () => {
    // Ply 20 = after 10 full moves each - White to move on move 11.
    expect(formatMoveListFromPly(20, ['Bb5', 'a6'])).toBe('11. Bb5 a6')
    // Ply 21 = Black to move on move 11.
    expect(formatMoveListFromPly(21, ['a6', 'Ba4'])).toBe('11...a6 12. Ba4')
  })

  it('returns an empty string for an empty move list', () => {
    expect(formatMoveListFromPly(0, [])).toBe('')
  })
})

describe('formatMoveList', () => {
  it('derives the correct ply count from a real (non-normalized) FEN', () => {
    // A real FEN including halfmove clock and fullmove number - White to move, move 15.
    const fen = '8/8/8/8/8/8/8/8 w - - 0 15'
    expect(formatMoveList(fen, ['c4', 'Nxc4'])).toBe('15. c4 Nxc4')
  })

  it('handles Black-to-move FENs the same way', () => {
    const fen = '8/8/8/8/8/8/8/8 b - - 0 3'
    expect(formatMoveList(fen, ['Nf6', 'a3'])).toBe('3...Nf6 4. a3')
  })

  it('falls back to move 1 for a FEN missing the fullmove-number field (e.g. a normalized FEN)', () => {
    // Documents the known limitation this is why formatMoveListFromPly exists.
    const normalizedFen = '8/8/8/8/8/8/8/8 w - -'
    expect(formatMoveList(normalizedFen, ['e4'])).toBe('1. e4')
  })
})
