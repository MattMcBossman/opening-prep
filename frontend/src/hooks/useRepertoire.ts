import { useCallback, useEffect, useState } from 'react'
import { normalizeFen, sideToMove } from '../lib/chessUtils'
import type { Repertoire, RepertoireColor, RepertoireMove, RepertoireTree } from '../types'

const STORAGE_KEY = 'opening-prep:repertoire'

function emptyRepertoire(): Repertoire {
  return { white: {}, black: {} }
}

/**
 * After removing an edge, its child position (`fen`) may have been the only way to
 * reach that position and everything beneath it. Delete that subtree - unless `fen`
 * is still reachable through some other surviving edge (a transposition into the
 * same position via a different line), in which case it - and everything beneath it
 * - stays. Mutates `tree` in place; the caller owns a fresh shallow copy of it.
 */
function deleteOrphanedSubtree(tree: RepertoireTree, fen: string): void {
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
 * place; the caller owns a fresh shallow copy of it.
 */
function pruneResponselessIncomingEdges(tree: RepertoireTree, color: RepertoireColor, originFen: string): void {
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

function loadRepertoire(): Repertoire {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyRepertoire()
    const parsed = JSON.parse(raw) as Partial<Repertoire>
    return { white: parsed.white ?? {}, black: parsed.black ?? {} }
  } catch {
    // localStorage may be unavailable (e.g. private browsing), or contain invalid JSON.
    return emptyRepertoire()
  }
}

/**
 * Client-side (localStorage-only) store for the user's saved repertoire moves, keyed
 * by normalized FEN per color. There is no backend yet (see AGENTS.md); this follows
 * the same persistence pattern as useLichessToken/useBoardColor.
 *
 * Any number of moves may be saved from a given position, for either the owner's own
 * turn or the opponent's reply - there is no "one main move" enforcement or conflict
 * detection. Removing a branch is an explicit user action (see removeMove).
 */
export function useRepertoire() {
  const [repertoire, setRepertoire] = useState<Repertoire>(loadRepertoire)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(repertoire))
    } catch {
      // Best-effort persistence only.
    }
  }, [repertoire])

  const getContinuations = useCallback(
    (color: RepertoireColor, fen: string): RepertoireMove[] => {
      return repertoire[color][normalizeFen(fen)] ?? []
    },
    [repertoire],
  )

  const isMoveSaved = useCallback(
    (color: RepertoireColor, fen: string, uci: string): boolean => {
      return getContinuations(color, fen).some((m) => m.uci === uci)
    },
    [getContinuations],
  )

  const addMove = useCallback((color: RepertoireColor, fen: string, move: RepertoireMove) => {
    const key = normalizeFen(fen)
    setRepertoire((prev) => {
      const existing = prev[color][key] ?? []
      if (existing.some((m) => m.uci === move.uci)) return prev
      const tree: RepertoireTree = { ...prev[color], [key]: [...existing, move] }
      return { ...prev, [color]: tree }
    })
  }, [])

  const removeMove = useCallback((color: RepertoireColor, fen: string, uci: string) => {
    const key = normalizeFen(fen)
    setRepertoire((prev) => {
      const existing = prev[color][key]
      if (!existing) return prev
      const removed = existing.find((m) => m.uci === uci)
      const remaining = existing.filter((m) => m.uci !== uci)
      const tree: RepertoireTree = { ...prev[color] }
      if (remaining.length > 0) {
        tree[key] = remaining
      } else {
        delete tree[key]
      }
      if (removed) {
        deleteOrphanedSubtree(tree, removed.resultingFen)
      }
      pruneResponselessIncomingEdges(tree, color, key)
      return { ...prev, [color]: tree }
    })
  }, [])

  return { getContinuations, isMoveSaved, addMove, removeMove }
}
