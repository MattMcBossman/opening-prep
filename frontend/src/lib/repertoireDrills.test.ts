import { describe, expect, it } from 'vitest'
import { collectDrillLines } from './repertoireDrills'
import { START_FEN } from '../hooks/useGame'
import { normalizeFen } from './chessUtils'
import type { RepertoireMove, RepertoireTree } from '../types'

// FENs below are illustrative placeholders, not real chess positions - collectDrillLines
// only reads tree structure + sideToMove parity from the FEN string, so this is sufficient.
// They're written already in normalized (4-field) form, matching how tree keys and
// RepertoireMove.resultingFen are actually stored (see useRepertoire.ts).
const ROOT = normalizeFen(START_FEN)
const AFTER_E4 = 'fen-after-1-e4 b - -'
const AFTER_E4_E5 = 'fen-after-1-e4-e5 w - -'
const AFTER_NF3 = 'fen-after-2-Nf3 b - -'
const AFTER_NC6 = 'fen-after-2...Nc6 w - -'
const AFTER_BB5 = 'fen-after-3-Bb5 b - -'
const AFTER_BC4 = 'fen-after-3-Bc4 b - -'
const AFTER_D4 = 'fen-after-1-d4 b - -'
const AFTER_D4_D5 = 'fen-after-1-d4-d5 w - -'

/** Mirrors useRepertoire's getContinuations(color, fen), bound to a plain tree object for tests. */
function continuationsFrom(tree: RepertoireTree): (fen: string) => RepertoireMove[] {
  return (fen: string) => tree[normalizeFen(fen)] ?? []
}

describe('collectDrillLines', () => {
  it('returns a single line for a repertoire with one saved continuation', () => {
    const tree: RepertoireTree = {
      [ROOT]: [{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }],
      [AFTER_E4]: [{ san: 'e5', uci: 'e7e5', resultingFen: AFTER_E4_E5 }],
    }
    const lines = collectDrillLines('white', continuationsFrom(tree))
    expect(lines).toHaveLength(1)
    expect(lines[0].steps.map((s) => s.uci)).toEqual(['e2e4', 'e7e5'])
    expect(lines[0].steps.map((s) => s.mover)).toEqual(['own', 'opponent'])
  })

  it('returns no lines for an empty repertoire', () => {
    expect(collectDrillLines('white', continuationsFrom({}))).toEqual([])
  })

  it('produces one leaf per own-move option, not a combinatorial product', () => {
    // White has saved two responses (3. Bb5 and 3. Bc4) to the same opponent line.
    const tree: RepertoireTree = {
      [ROOT]: [{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }],
      [AFTER_E4]: [{ san: 'e5', uci: 'e7e5', resultingFen: AFTER_E4_E5 }],
      [AFTER_E4_E5]: [{ san: 'Nf3', uci: 'g1f3', resultingFen: AFTER_NF3 }],
      [AFTER_NF3]: [{ san: 'Nc6', uci: 'b8c6', resultingFen: AFTER_NC6 }],
      [AFTER_NC6]: [
        { san: 'Bb5', uci: 'f1b5', resultingFen: AFTER_BB5 },
        { san: 'Bc4', uci: 'f1c4', resultingFen: AFTER_BC4 },
      ],
    }
    const lines = collectDrillLines('white', continuationsFrom(tree))
    expect(lines).toHaveLength(2)
    const finalMoves = lines.map((l) => l.steps[l.steps.length - 1].san).sort()
    expect(finalMoves).toEqual(['Bb5', 'Bc4'])
    // Both lines share the same 4-move prefix before diverging.
    for (const line of lines) {
      expect(line.steps.slice(0, 4).map((s) => s.uci)).toEqual(['e2e4', 'e7e5', 'g1f3', 'b8c6'])
    }
  })

  it('adds leaves for sibling branches (e.g. two first moves) rather than multiplying', () => {
    const tree: RepertoireTree = {
      [ROOT]: [
        { san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 },
        { san: 'd4', uci: 'd2d4', resultingFen: AFTER_D4 },
      ],
      [AFTER_E4]: [{ san: 'e5', uci: 'e7e5', resultingFen: AFTER_E4_E5 }],
      [AFTER_D4]: [{ san: 'd5', uci: 'd7d5', resultingFen: AFTER_D4_D5 }],
    }
    const lines = collectDrillLines('white', continuationsFrom(tree))
    expect(lines).toHaveLength(2)
  })

  it('includes every saved opponent reply as its own leaf', () => {
    const AFTER_E4_C5 = 'fen-after-1-e4-c5 w - -'
    const tree: RepertoireTree = {
      [ROOT]: [{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }],
      [AFTER_E4]: [
        { san: 'e5', uci: 'e7e5', resultingFen: AFTER_E4_E5 },
        { san: 'c5', uci: 'c7c5', resultingFen: AFTER_E4_C5 },
      ],
    }
    const lines = collectDrillLines('white', continuationsFrom(tree))
    expect(lines).toHaveLength(2)
    const secondMoves = lines.map((l) => l.steps[1].san).sort()
    expect(secondMoves).toEqual(['c5', 'e5'])
  })

  it('supports rooting the walk at a subtree instead of the repertoire root', () => {
    const tree: RepertoireTree = {
      [ROOT]: [{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }],
      [AFTER_E4]: [{ san: 'e5', uci: 'e7e5', resultingFen: AFTER_E4_E5 }],
    }
    const lines = collectDrillLines('white', continuationsFrom(tree), AFTER_E4)
    expect(lines).toHaveLength(1)
    expect(lines[0].steps.map((s) => s.uci)).toEqual(['e7e5'])
  })

  it('does not loop forever if a saved move cycles back to an ancestor position', () => {
    const tree: RepertoireTree = {
      [ROOT]: [{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }],
      [AFTER_E4]: [{ san: 'weird', uci: 'a1a1', resultingFen: ROOT }],
    }
    expect(() => collectDrillLines('white', continuationsFrom(tree))).not.toThrow()
    expect(collectDrillLines('white', continuationsFrom(tree))).toEqual([])
  })
})
