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
  /** Every personal module/global release that contributed this identical line. */
  sources?: DrillLineSource[]
}

export type DrillLineSource =
  | { kind: 'repertoire'; id: number; lineId?: string; name?: string }
  | { kind: 'template_release'; id: number; lineId?: string; name?: string }

export type DrillStartMode = 'beginning' | 'selected_position'

export type DrillStartContext = {
  /** Complete six-field FEN used when starting at the selected position. */
  selectedFen: string
  selectedPly: number
  /** Moves from the initial position through the selected occurrence. */
  prefixUci: string[]
  openingName?: string
  openingEco?: string
  /** Ply whose exact position supplied openingName; distinguishes a current match from an inherited name. */
  openingNamePly?: number
  positionMoveLabel?: string
}

/** Adds move-order context only when an opening name was inherited from an earlier position. */
export function openingDisambiguationLabel(
  history: readonly { san: string }[],
  selectedPly: number,
  openingNamePly: number | null | undefined,
): string | undefined {
  if (selectedPly < 1 || (openingNamePly !== null && (openingNamePly === undefined || openingNamePly >= selectedPly))) return undefined
  const move = history[selectedPly - 1]
  if (!move) return undefined
  const moveNumber = Math.ceil(selectedPly / 2)
  return selectedPly % 2 === 1 ? `${moveNumber}.${move.san}` : `${moveNumber}...${move.san}`
}

/** Removes ambiguous labels written before opening-name resolution ply was persisted. */
export function migrateDrillStartContext(context: DrillStartContext | undefined): DrillStartContext | undefined {
  if (!context?.openingName || !context.positionMoveLabel || context.openingNamePly !== undefined) return context
  return { ...context, positionMoveLabel: undefined }
}

/** Captures the exact explorer occurrence used by the "Drill from here" handoff. */
export function createDrillStartContext(
  selectedFen: string,
  selectedPly: number,
  history: readonly { uci: string }[],
  details?: Pick<DrillStartContext, 'openingName' | 'openingEco' | 'openingNamePly' | 'positionMoveLabel'>,
): DrillStartContext {
  return {
    selectedFen,
    selectedPly,
    prefixUci: history.slice(0, selectedPly).map((move) => move.uci),
    ...details,
  }
}

export type PreparedDrill = {
  lines: DrillLine[]
  rootFen: string
}

/** Reconstructs move-one history for opening a completed drill in Explorer. */
export function completedDrillHistoryUci(
  line: DrillLine,
  mode: DrillStartMode,
  context?: DrillStartContext,
): string[] {
  const practicedUci = line.steps.map((step) => step.uci)
  return mode === 'selected_position' ? [...(context?.prefixUci ?? []), ...practicedUci] : practicedUci
}

function lineKey(line: DrillLine): string {
  return line.steps.map((step) => step.uci).join(' ')
}

/** Deduplicates identical played lines while retaining all source provenance. */
export function mergeDrillLines(lines: readonly DrillLine[]): DrillLine[] {
  const merged = new Map<string, DrillLine>()
  for (const line of lines) {
    const key = lineKey(line)
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, { ...line, id: key, steps: [...line.steps], sources: [...(line.sources ?? [])] })
      continue
    }
    const sourceKeys = new Set((existing.sources ?? []).map((source) => `${source.kind}:${source.id}:${source.lineId ?? ''}`))
    for (const source of line.sources ?? []) {
      const sourceKey = `${source.kind}:${source.id}:${source.lineId ?? ''}`
      if (!sourceKeys.has(sourceKey)) {
        existing.sources?.push(source)
        sourceKeys.add(sourceKey)
      }
    }
  }
  return [...merged.values()]
}

function normalizedFenMatches(left: string, right: string): boolean {
  try {
    return normalizeFen(left) === normalizeFen(right)
  } catch {
    return left === right
  }
}

/**
 * Filters full authored lines through a selected explorer occurrence and then
 * presents them either from move one or from that position. Exact prefix
 * matching is deliberately preferred: FEN alone loses authored move order at
 * transpositions and can be ambiguous in repetitions.
 */
export function prepareDrillLines(
  lines: readonly DrillLine[],
  mode: DrillStartMode = 'beginning',
  context?: DrillStartContext,
): PreparedDrill {
  const deduped = mergeDrillLines(lines)
  if (!context) return { lines: deduped, rootFen: START_FEN }

  const prefixLength = context.prefixUci.length
  let eligible = prefixLength > 0
    ? deduped.filter((line) =>
        context.prefixUci.every((uci, index) => line.steps[index]?.uci === uci)
        && normalizedFenMatches(line.steps[prefixLength - 1]?.resultingFen ?? '', context.selectedFen),
      )
    : []

  // Launches from dashboards may have no explorer history. Match the selected
  // occurrence by ply/FEN in that case; selectedPly disambiguates repetitions.
  if (prefixLength === 0) {
    eligible = deduped.filter((line) => {
      if (context.selectedPly === 0) return normalizedFenMatches(context.selectedFen, START_FEN)
      return normalizedFenMatches(line.steps[context.selectedPly - 1]?.resultingFen ?? '', context.selectedFen)
    })
  }

  if (mode === 'beginning') return { lines: eligible, rootFen: START_FEN }

  const sliced = eligible
    .map((line) => {
      const steps = line.steps.slice(prefixLength || context.selectedPly)
      return { ...line, id: lineKey({ ...line, steps }), steps }
    })
    // A line ending exactly at the selected position has nothing left to drill.
    .filter((line) => line.steps.length > 0)
  return { lines: mergeDrillLines(sliced), rootFen: context.selectedFen }
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
