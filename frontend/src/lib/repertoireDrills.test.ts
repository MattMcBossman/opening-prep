import { describe, expect, it } from 'vitest'
import {
  collectDrillLines,
  completedDrillHistoryUci,
  createDrillStartContext,
  migrateDrillStartContext,
  openingDisambiguationLabel,
  mergeDrillLines,
  prepareDrillLines,
} from './repertoireDrills'
import type { DrillLine, DrillStep } from './repertoireDrills'
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

function step(fen: string, uci: string, resultingFen: string, mover: 'own' | 'opponent'): DrillStep {
  return { fen, san: uci, uci, resultingFen, mover }
}

const FULL_LINE: DrillLine = {
  id: 'line-a',
  steps: [
    step(START_FEN, 'e2e4', AFTER_E4, 'own'),
    step(AFTER_E4, 'e7e5', AFTER_E4_E5, 'opponent'),
    step(AFTER_E4_E5, 'g1f3', AFTER_NF3, 'own'),
  ],
  sources: [{ kind: 'repertoire', id: 1, lineId: 'line-a' }],
}

describe('mergeDrillLines', () => {
  it('drills an identical composed line once and retains every source', () => {
    const duplicate = { ...FULL_LINE, id: 'line-b', sources: [{ kind: 'template_release' as const, id: 7, lineId: 'line-b' }] }
    const merged = mergeDrillLines([FULL_LINE, duplicate])
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe('e2e4 e7e5 g1f3')
    expect(merged[0].sources).toEqual([
      { kind: 'repertoire', id: 1, lineId: 'line-a' },
      { kind: 'template_release', id: 7, lineId: 'line-b' },
    ])
  })
})

describe('prepareDrillLines', () => {
  const selectedFen = `${AFTER_E4_E5} 0 2`
  const context = { selectedFen, selectedPly: 2, prefixUci: ['e2e4', 'e7e5'] }

  it('uses exact prefix matching to select authored move order through a transposition', () => {
    const alternate = {
      ...FULL_LINE,
      id: 'alternate',
      steps: [step(START_FEN, 'd2d4', AFTER_D4, 'own'), ...FULL_LINE.steps.slice(1)],
    }
    const prepared = prepareDrillLines([FULL_LINE, alternate], 'beginning', context)
    expect(prepared.lines.map((line) => line.steps.map((item) => item.uci))).toEqual([
      ['e2e4', 'e7e5', 'g1f3'],
    ])
    expect(prepared.rootFen).toBe(START_FEN)
  })

  it('starts at the complete selected FEN and slices away the entry path', () => {
    const prepared = prepareDrillLines([FULL_LINE], 'selected_position', context)
    expect(prepared.rootFen).toBe(selectedFen)
    expect(prepared.lines[0].steps.map((item) => item.uci)).toEqual(['g1f3'])
    expect(prepared.lines[0].sources).toEqual(FULL_LINE.sources)
  })

  it('keeps the full eligible line in start-from-move-one mode', () => {
    const prepared = prepareDrillLines([FULL_LINE], 'beginning', context)
    expect(prepared.lines[0].steps).toHaveLength(3)
  })

  it('falls back to selected ply and normalized FEN without explorer history', () => {
    const prepared = prepareDrillLines(
      [FULL_LINE],
      'selected_position',
      { selectedFen, selectedPly: 2, prefixUci: [] },
    )
    expect(prepared.lines[0].steps.map((item) => item.uci)).toEqual(['g1f3'])
  })

  it('treats a zero-ply selected position as the root of every line', () => {
    const prepared = prepareDrillLines(
      [FULL_LINE],
      'selected_position',
      { selectedFen: 'stale-restored-root', selectedPly: 0, prefixUci: [] },
    )
    expect(prepared.lines).toHaveLength(1)
    expect(prepared.lines[0].steps).toEqual(FULL_LINE.steps)
    expect(prepared.rootFen).toBe(START_FEN)
  })

  it('excludes a line that ends exactly at the selected position', () => {
    const short = { ...FULL_LINE, steps: FULL_LINE.steps.slice(0, 2) }
    expect(prepareDrillLines([short], 'selected_position', context).lines).toEqual([])
  })
})

describe('explorer drill handoff', () => {
  const viennaHistory = [
    { san: 'e4' },
    { san: 'e5' },
    { san: 'Nc3' },
    { san: 'Nf6' },
    { san: 'f4' },
    { san: 'd5' },
    { san: 'fxe5' },
    { san: 'Bc5' },
  ]

  it('does not append the move that establishes the exact opening name', () => {
    expect(openingDisambiguationLabel(viennaHistory, 3, 3)).toBeUndefined()
  })

  it('identifies an otherwise unnamed selected position by its final move', () => {
    expect(openingDisambiguationLabel(viennaHistory, 2, null)).toBe('1...e5')
  })

  it('appends only the final move when an opening name was inherited', () => {
    expect(openingDisambiguationLabel(viennaHistory, 8, 3)).toBe('4...Bc5')
  })

  it('drops a redundant move label from legacy persisted drill state', () => {
    expect(migrateDrillStartContext({
      selectedFen: AFTER_E4_E5,
      selectedPly: 3,
      prefixUci: ['e2e4', 'e7e5', 'b1c3'],
      openingName: 'Vienna Game',
      positionMoveLabel: '2. Nc3',
    })).toMatchObject({ openingName: 'Vienna Game', positionMoveLabel: undefined })
  })

  it('captures only the played prefix at the selected history pointer', () => {
    expect(
      createDrillStartContext('selected complete fen', 2, [
        { uci: 'e2e4' },
        { uci: 'e7e5' },
        { uci: 'g1f3' },
      ]),
    ).toEqual({
      selectedFen: 'selected complete fen',
      selectedPly: 2,
      prefixUci: ['e2e4', 'e7e5'],
    })
  })

  it('reconstructs a completed full-line drill instead of returning an empty history', () => {
    expect(completedDrillHistoryUci(FULL_LINE, 'beginning')).toEqual(['e2e4', 'e7e5', 'g1f3'])
  })

  it('prepends explorer history to a completed selected-position drill', () => {
    const context = { selectedFen: AFTER_E4_E5, selectedPly: 2, prefixUci: ['e2e4', 'e7e5'] }
    const slicedLine = prepareDrillLines([FULL_LINE], 'selected_position', context).lines[0]
    expect(completedDrillHistoryUci(slicedLine, 'selected_position', context)).toEqual([
      'e2e4',
      'e7e5',
      'g1f3',
    ])
  })
})
