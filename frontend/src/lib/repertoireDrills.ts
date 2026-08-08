import { START_FEN } from '../hooks/useGame'
import { normalizeFen, sideToMove } from './chessUtils'
import type { RepertoireColor, RepertoireMove } from '../types'

export type DrillMover = 'own' | 'opponent'

export type DrillStep = {
  /** Origin FEN (before this move), not normalized. */
  fen: string
  san: string
  uci: string
  /** Normalized resulting FEN (see normalizeFen), used as the repertoire tree key. */
  resultingFen: string
  /** Whose move this is: the repertoire owner's ("own") or the opponent's. */
  mover: DrillMover
}

export type DrillLine = {
  /** Stable identity for this line within one enumeration - the played UCI sequence. */
  id: string
  steps: DrillStep[]
}

/**
 * Walks the repertoire from `rootFen` and returns one `DrillLine` per leaf (a
 * position with no further saved continuations) - see AGENTS.md/the Phase 3
 * plan's "leaf-path enumeration" design. Leaf count is additive across sibling
 * branches (never multiplicative), so this stays proportional to the number of
 * lines actually saved, regardless of how many branch points exist along the way.
 *
 * `getContinuations` is expected to be `useRepertoire`'s continuation lookup
 * bound to one color (e.g. `(fen) => repertoire.getContinuations(color, fen)`) -
 * this walks the tree purely through that public API rather than needing a raw
 * `RepertoireTree` reference. Every edge is included as a step, tagged with
 * whose move it is (`own` vs `opponent`) based on `sideToMove` at that edge's
 * origin - both are always present in the tree (see useRepertoire.ts), since
 * saving one of the owner's moves cascades to save the opponent replies leading
 * up to it too.
 */
export function collectDrillLines(
  color: RepertoireColor,
  getContinuations: (fen: string) => RepertoireMove[],
  rootFen: string = START_FEN,
): DrillLine[] {
  const lines: DrillLine[] = []

  function walk(fen: string, steps: DrillStep[], visited: ReadonlySet<string>) {
    const key = normalizeFen(fen)
    const moves = getContinuations(fen)
    if (moves.length === 0) {
      if (steps.length > 0) {
        lines.push({ id: steps.map((s) => s.uci).join(' '), steps })
      }
      return
    }

    const mover: DrillMover = sideToMove(fen) === color ? 'own' : 'opponent'
    for (const move of moves) {
      // Defensive guard against a cycle (a saved move leading back to a position
      // already on this path) - not expected in practice for a real repertoire,
      // but would otherwise recurse forever. Just drop this edge rather than
      // recursing into it; any actual leaves reached via sibling moves are still
      // collected normally.
      if (visited.has(move.resultingFen)) continue
      const step: DrillStep = { fen, san: move.san, uci: move.uci, resultingFen: move.resultingFen, mover }
      walk(move.resultingFen, [...steps, step], new Set(visited).add(key))
    }
  }

  walk(rootFen, [], new Set())
  return lines
}
