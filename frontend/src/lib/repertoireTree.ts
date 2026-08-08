import { normalizeFen, sideToMove } from './chessUtils'
import type { RepertoireColor, RepertoireMove, RepertoireTree } from '../types'

/**
 * After removing an edge, its child position (`fen`) may have been the only way to
 * reach that position and everything beneath it. Delete that subtree - unless `fen`
 * is still reachable through some other surviving edge (a transposition into the
 * same position via a different line), in which case it - and everything beneath it
 * - stays. Mutates `tree` in place; callers own a fresh shallow copy of it (see
 * `removeMoveFromTree`).
 */
export function deleteOrphanedSubtree(tree: RepertoireTree, fen: string): void {
  // Defensive: resultingFen is documented as always normalized already, but tree
  // lookups here must not silently no-op if that invariant is ever violated.
  const key = normalizeFen(fen)
  const stillReachable = Object.values(tree).some((moves) => moves.some((m) => m.resultingFen === key))
  if (stillReachable) return

  const children = tree[key]
  if (!children) return
  delete tree[key]
  for (const child of children) {
    deleteOrphanedSubtree(tree, child.resultingFen)
  }
}

/**
 * After removing an edge, its origin position may now have zero moves saved from it.
 * If that origin is a position where it's the repertoire owner's own turn, any
 * "opponent reply" edge elsewhere in the tree that leads here no longer has a
 * prepped response, so it's no longer useful - remove those too. The reverse case
 * (the owner's own move having no opponent reply prepped yet) is a normal, valid
 * state and is deliberately NOT pruned this way - see AGENTS.md. Mutates `tree` in
 * place; callers own a fresh shallow copy of it (see `removeMoveFromTree`).
 */
export function pruneResponselessIncomingEdges(tree: RepertoireTree, color: RepertoireColor, originFen: string): void {
  const key = normalizeFen(originFen)
  if (tree[key]) return // still has saved moves, not actually childless
  if (sideToMove(key) !== color) return // a childless opponent-reply-to-be node is normal, not pruned

  for (const [origin, edges] of Object.entries(tree)) {
    const remaining = edges.filter((m) => m.resultingFen !== key)
    if (remaining.length === edges.length) continue
    if (remaining.length > 0) {
      tree[origin] = remaining
    } else {
      delete tree[origin]
    }
  }
}

/**
 * Adds `move` under normalized `fen`, returning a new tree object - or the exact
 * same `tree` reference when the edge is already saved, so a caller doing
 * `setState(addMoveToTree(...))` bails out of a re-render for a no-op add. That
 * idempotency matters: App.tsx's cascade-save (`onTogglePlySaved`) replays every
 * earlier ply in a line unconditionally, relying on already-saved ancestors being
 * harmless no-ops rather than duplicate entries.
 */
export function addMoveToTree(tree: RepertoireTree, fen: string, move: RepertoireMove): RepertoireTree {
  const key = normalizeFen(fen)
  const existing = tree[key] ?? []
  if (existing.some((m) => m.uci === move.uci)) return tree
  return { ...tree, [key]: [...existing, move] }
}

/**
 * Removes the edge `(fen, uci)` and applies the cascade-delete rules documented in
 * AGENTS.md - see `deleteOrphanedSubtree`/`pruneResponselessIncomingEdges`. Returns
 * the same `tree` reference (no-op) if the edge doesn't exist, for the same
 * bail-out-of-re-render reason as `addMoveToTree`.
 */
export function removeMoveFromTree(tree: RepertoireTree, color: RepertoireColor, fen: string, uci: string): RepertoireTree {
  const key = normalizeFen(fen)
  const existing = tree[key]
  if (!existing) return tree
  const removed = existing.find((m) => m.uci === uci)
  const remaining = existing.filter((m) => m.uci !== uci)
  const next: RepertoireTree = { ...tree }
  if (remaining.length > 0) {
    next[key] = remaining
  } else {
    delete next[key]
  }
  if (removed) {
    deleteOrphanedSubtree(next, removed.resultingFen)
  }
  pruneResponselessIncomingEdges(next, color, key)
  return next
}

export function isRepertoireEmpty(tree: RepertoireTree): boolean {
  return Object.keys(tree).length === 0
}
