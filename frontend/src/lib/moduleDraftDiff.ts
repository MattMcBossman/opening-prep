import { START_FEN } from '../hooks/useGame'
import type { RepertoireColor, RepertoireMove, RepertoireTree } from '../types'
import { normalizeFen } from './chessUtils'
import { collectDrillLines, type DrillLine } from './repertoireDrills'

export type ModuleMoveUpdate = {
  kind: 'add' | 'delete'
  originFen: string
  move: RepertoireMove
}

export type ModuleLineUpdate = {
  kind: 'add' | 'delete'
  line: DrillLine
  /** First move in the line that is actually new or removed from the tree. */
  changedFromPly: number
}

export type ModuleDraftDiff = {
  moves: ModuleMoveUpdate[]
  lines: ModuleLineUpdate[]
  addedMoveCount: number
  deletedMoveCount: number
  addedLineCount: number
  deletedLineCount: number
}

function moveMap(tree: RepertoireTree) {
  const result = new Map<string, { originFen: string; move: RepertoireMove }>()
  for (const [originFen, moves] of Object.entries(tree)) {
    for (const move of moves) result.set(`${normalizeFen(originFen)}|${move.uci}`, { originFen, move })
  }
  return result
}

function lines(tree: RepertoireTree, color: RepertoireColor) {
  return collectDrillLines(color, (fen) => tree[normalizeFen(fen)] ?? [], START_FEN)
}

/** Returns the net module update, independent of the order used to edit the draft. */
export function diffModuleDraft(persisted: RepertoireTree, draft: RepertoireTree, color: RepertoireColor): ModuleDraftDiff {
  const beforeMoves = moveMap(persisted)
  const afterMoves = moveMap(draft)
  const moves: ModuleMoveUpdate[] = []
  for (const [key, value] of afterMoves) if (!beforeMoves.has(key)) moves.push({ kind: 'add', ...value })
  for (const [key, value] of beforeMoves) if (!afterMoves.has(key)) moves.push({ kind: 'delete', ...value })

  const beforeLines = new Map(lines(persisted, color).map((line) => [line.id, line]))
  const afterLines = new Map(lines(draft, color).map((line) => [line.id, line]))
  const lineUpdates: ModuleLineUpdate[] = []
  for (const [key, line] of afterLines) if (!beforeLines.has(key)) {
    const changedFromPly = line.steps.findIndex((step) => !beforeMoves.has(`${normalizeFen(step.fen)}|${step.uci}`))
    // Extending an existing leaf also makes the shorter leaf cease to be a
    // drill line. Only report the new line that contains a real tree change.
    if (changedFromPly >= 0) lineUpdates.push({ kind: 'add', line, changedFromPly })
  }
  for (const [key, line] of beforeLines) if (!afterLines.has(key)) {
    const changedFromPly = line.steps.findIndex((step) => !afterMoves.has(`${normalizeFen(step.fen)}|${step.uci}`))
    if (changedFromPly >= 0) lineUpdates.push({ kind: 'delete', line, changedFromPly })
  }

  return {
    moves,
    lines: lineUpdates,
    addedMoveCount: moves.filter((update) => update.kind === 'add').length,
    deletedMoveCount: moves.filter((update) => update.kind === 'delete').length,
    addedLineCount: lineUpdates.filter((update) => update.kind === 'add').length,
    deletedLineCount: lineUpdates.filter((update) => update.kind === 'delete').length,
  }
}

export function moduleMoveDraftState(
  persisted: RepertoireTree,
  draft: RepertoireTree,
  originFen: string,
  uci: string,
): 'unsaved' | 'saved' | 'pending-add' | 'pending-remove' {
  const key = normalizeFen(originFen)
  const wasSaved = (persisted[key] ?? []).some((move) => move.uci === uci)
  const isSaved = (draft[key] ?? []).some((move) => move.uci === uci)
  if (!wasSaved && isSaved) return 'pending-add'
  if (wasSaved && !isSaved) return 'pending-remove'
  return isSaved ? 'saved' : 'unsaved'
}
