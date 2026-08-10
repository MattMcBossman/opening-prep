import { describe, expect, it } from 'vitest'
import { exportRepertoireToPgn } from './pgnExport'
import { START_FEN } from '../hooks/useGame'
import { normalizeFen } from './chessUtils'
import type { RepertoireTree } from '../types'

// Illustrative placeholder FENs, not real chess positions - exportRepertoireToPgn
// only reads tree structure + stored SAN strings, matching the style already used
// in repertoireDrills.test.ts.
const ROOT = normalizeFen(START_FEN)
const AFTER_E4 = 'fen-after-1-e4 b - -'
const AFTER_E4_E5 = 'fen-after-1-e4-e5 w - -'
const AFTER_E4_C5 = 'fen-after-1-e4-c5 w - -'
const AFTER_NF3 = 'fen-after-2-Nf3 b - -'

function firstLine(pgn: string): string {
  return pgn.split('\n\n')[1].trim()
}

describe('exportRepertoireToPgn', () => {
  it('exports an empty repertoire as just a result marker', () => {
    expect(firstLine(exportRepertoireToPgn({}, 'white'))).toBe('*')
  })

  it('exports a single line with standard move-number formatting', () => {
    const tree: RepertoireTree = {
      [ROOT]: [{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }],
      [AFTER_E4]: [{ san: 'e5', uci: 'e7e5', resultingFen: AFTER_E4_E5 }],
      [AFTER_E4_E5]: [{ san: 'Nf3', uci: 'g1f3', resultingFen: AFTER_NF3 }],
    }
    expect(firstLine(exportRepertoireToPgn(tree, 'white'))).toBe('1. e4 e5 2. Nf3 *')
  })

  it('embeds an encoded authored-line label at its leaf', () => {
    const tree: RepertoireTree = {
      [ROOT]: [{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }],
      [AFTER_E4]: [{ san: 'e5', uci: 'e7e5', resultingFen: AFTER_E4_E5 }],
    }
    expect(firstLine(exportRepertoireToPgn(tree, 'white', [{ uciPath: 'e2e4 e7e5', label: 'Vienna: main & sharp' }]))).toBe(
      '1. e4 e5 {[%opening-prep-line e2e4%20e7e5|Vienna%3A%20main%20%26%20sharp]} *',
    )
  })

  it('exports persisted comments and NAGs after their annotated move', () => {
    const tree: RepertoireTree = {
      [ROOT]: [{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }],
      [AFTER_E4]: [{ san: 'e5', uci: 'e7e5', resultingFen: AFTER_E4_E5 }],
    }
    const pgn = exportRepertoireToPgn(tree, 'white', [{
      uciPath: 'e2e4 e7e5',
      label: '',
      annotations: [{ ply: 0, comment: 'Controls the center', nags: [1] }],
    }])
    expect(firstLine(pgn)).toBe('1. e4 $1 {Controls the center} e5 *')
  })

  it('includes minimal headers naming the exported color', () => {
    const pgn = exportRepertoireToPgn({}, 'black')
    expect(pgn).toContain('[Event "opening-prep Black repertoire"]')
    expect(pgn).toContain('[Result "*"]')
  })

  it('emits a sibling continuation as a parenthesized variation, in insertion order', () => {
    // Mainline is the first-added edge (e5); the second (c5) becomes a variation.
    const tree: RepertoireTree = {
      [ROOT]: [{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }],
      [AFTER_E4]: [
        { san: 'e5', uci: 'e7e5', resultingFen: AFTER_E4_E5 },
        { san: 'c5', uci: 'c7c5', resultingFen: AFTER_E4_C5 },
      ],
    }
    expect(firstLine(exportRepertoireToPgn(tree, 'white'))).toBe('1. e4 e5 (1...c5) *')
  })

  it('gives a Black-starting variation its own move-number ellipsis, and continues it recursively', () => {
    const AFTER_E4_C5_NF3 = 'fen-after-1-e4-c5-Nf3 b - -'
    const tree: RepertoireTree = {
      [ROOT]: [{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }],
      [AFTER_E4]: [
        { san: 'e5', uci: 'e7e5', resultingFen: AFTER_E4_E5 },
        { san: 'c5', uci: 'c7c5', resultingFen: AFTER_E4_C5 },
      ],
      [AFTER_E4_C5]: [{ san: 'Nf3', uci: 'g1f3', resultingFen: AFTER_E4_C5_NF3 }],
    }
    expect(firstLine(exportRepertoireToPgn(tree, 'white'))).toBe('1. e4 e5 (1...c5 2. Nf3) *')
  })

  it('duplicates a transposition reached via two different lines', () => {
    // 1.e4 and 1.d4 both (implausibly) lead to the same position, which has its
    // own further continuation - that continuation must appear under both.
    const AFTER_D4 = 'fen-after-1-d4 b - -'
    const AFTER_SHARED = 'fen-shared-transposition w - -'
    const tree: RepertoireTree = {
      [ROOT]: [
        { san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 },
        { san: 'd4', uci: 'd2d4', resultingFen: AFTER_D4 },
      ],
      [AFTER_E4]: [{ san: 'e5', uci: 'e7e5', resultingFen: AFTER_SHARED }],
      [AFTER_D4]: [{ san: 'e5', uci: 'e7e5', resultingFen: AFTER_SHARED }],
      [AFTER_SHARED]: [{ san: 'Nf3', uci: 'g1f3', resultingFen: AFTER_NF3 }],
    }
    // The variation attaches right after the move it's an alternative to (1. e4,
    // the ROOT-level branch point) - not at the end of the mainline - and since
    // d4 is White's move, it gets a plain "1.", not an ellipsis.
    expect(firstLine(exportRepertoireToPgn(tree, 'white'))).toBe('1. e4 (1. d4 e5 2. Nf3) e5 2. Nf3 *')
  })

  it('does not loop forever on a saved move that cycles back to an ancestor position', () => {
    const tree: RepertoireTree = {
      [ROOT]: [{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }],
      [AFTER_E4]: [{ san: 'weird', uci: 'a1a1', resultingFen: ROOT }],
    }
    expect(() => exportRepertoireToPgn(tree, 'white')).not.toThrow()
    // The cycling move itself is still shown once; only re-descending into the
    // already-visited ancestor position is suppressed.
    expect(firstLine(exportRepertoireToPgn(tree, 'white'))).toBe('1. e4 weird *')
  })
})
