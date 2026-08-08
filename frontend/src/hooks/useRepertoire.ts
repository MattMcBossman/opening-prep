import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizeFen } from '../lib/chessUtils'
import { addMoveToTree, isRepertoireEmpty, removeMoveFromTree } from '../lib/repertoireTree'
import {
  addRepertoireMoves,
  ensureRepertoires,
  fetchRepertoireTree,
  importRepertoire,
  removeRepertoireMove,
} from '../lib/repertoireApi'
import type { ImportSummary, MoveEdge } from '../lib/repertoireApi'
import type { AuthUser } from '../lib/authApi'
import type { Repertoire, RepertoireColor, RepertoireMove } from '../types'

const STORAGE_KEY = 'opening-prep:repertoire'
const IMPORT_STATUS_KEY_PREFIX = 'opening-prep:repertoire-import-status:'

function emptyRepertoire(): Repertoire {
  return { white: {}, black: {} }
}

function loadLocalRepertoire(): Repertoire {
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.'
}

/**
 * Client-side (localStorage-only) store for the anonymous user's repertoire -
 * exactly Phase 2's behaviour (see AGENTS.md), just factored through the
 * shared `repertoireTree` cascade logic so `useApiRepertoireStore` below can
 * reuse the exact same rules for its optimistic updates. This stays the only
 * store for anonymous use, and is also what the one-time import prompt reads
 * the local data from.
 */
function useLocalRepertoireStore() {
  const [repertoire, setRepertoire] = useState<Repertoire>(loadLocalRepertoire)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(repertoire))
    } catch {
      // Best-effort persistence only.
    }
  }, [repertoire])

  const getContinuations = useCallback(
    (color: RepertoireColor, fen: string): RepertoireMove[] => repertoire[color][normalizeFen(fen)] ?? [],
    [repertoire],
  )

  const isMoveSaved = useCallback(
    (color: RepertoireColor, fen: string, uci: string): boolean => getContinuations(color, fen).some((m) => m.uci === uci),
    [getContinuations],
  )

  const addMove = useCallback((color: RepertoireColor, fen: string, move: RepertoireMove) => {
    setRepertoire((prev) => {
      const tree = addMoveToTree(prev[color], fen, move)
      return tree === prev[color] ? prev : { ...prev, [color]: tree }
    })
  }, [])

  const removeMove = useCallback((color: RepertoireColor, fen: string, uci: string) => {
    setRepertoire((prev) => {
      const tree = removeMoveFromTree(prev[color], color, fen, uci)
      return tree === prev[color] ? prev : { ...prev, [color]: tree }
    })
  }, [])

  return { repertoire, getContinuations, isMoveSaved, addMove, removeMove }
}

type ApiStoreStatus = 'idle' | 'loading' | 'ready' | 'error'

type ApiStoreState = {
  status: ApiStoreStatus
  ids: Partial<Record<RepertoireColor, number>>
  tree: Repertoire
  error: string | null
}

const INITIAL_API_STATE: ApiStoreState = { status: 'idle', ids: {}, tree: { white: {}, black: {} }, error: null }

/**
 * Backend-backed store, active only while signed in. Mutations are applied
 * optimistically (via the same `repertoireTree` cascade logic the local store
 * uses) so the UI never waits on a round trip, then reconciled with the
 * server's canonical tree. A failed mutation re-fetches that color's tree from
 * the server rather than hand-computing an inverse patch, which would be
 * fragile if another batched add interleaved with it (see `flushAdds`) - the
 * goal is just "never leave the UI lying about what's saved", not a perfect
 * undo.
 */
function useApiRepertoireStore(enabled: boolean) {
  const [state, setState] = useState<ApiStoreState>(INITIAL_API_STATE)
  const idsRef = useRef(state.ids)
  useEffect(() => {
    idsRef.current = state.ids
  }, [state.ids])

  const load = useCallback(() => {
    setState((s) => ({ ...s, status: 'loading', error: null }))
    return ensureRepertoires().then(
      (result) => {
        setState({
          status: 'ready',
          ids: { white: result.white.id, black: result.black.id },
          tree: { white: result.white.tree, black: result.black.tree },
          error: null,
        })
      },
      (err: unknown) => {
        setState((s) => ({ ...s, status: 'error', error: errorMessage(err) }))
      },
    )
  }, [])

  useEffect(() => {
    if (!enabled) {
      setState(INITIAL_API_STATE)
      return
    }
    load()
  }, [enabled, load])

  // Batches same-tick `addMove` calls into a single POST - saving a move
  // cascades to save every earlier ply in the line (see App.tsx's
  // onTogglePlySaved), which would otherwise be N sequential requests instead
  // of the one batched request the backend expects (see the Phase 4 plan).
  const pendingAddsRef = useRef<Record<RepertoireColor, Map<string, MoveEdge>>>({ white: new Map(), black: new Map() })
  const addFlushScheduledRef = useRef<Record<RepertoireColor, boolean>>({ white: false, black: false })

  const flushAdds = useCallback((color: RepertoireColor) => {
    addFlushScheduledRef.current[color] = false
    const pending = pendingAddsRef.current[color]
    if (pending.size === 0) return
    const moves = Array.from(pending.values())
    pending.clear()
    const id = idsRef.current[color]
    if (id === undefined) return // Shouldn't happen once `ready`, but guards a race with sign-out.
    addRepertoireMoves(id, moves).then(
      (tree) => setState((s) => ({ ...s, tree: { ...s.tree, [color]: tree } })),
      (err: unknown) => {
        setState((s) => ({ ...s, error: errorMessage(err) }))
        fetchRepertoireTree(id).then((tree) => setState((s) => ({ ...s, tree: { ...s.tree, [color]: tree } })), () => {})
      },
    )
  }, [])

  const addMove = useCallback(
    (color: RepertoireColor, fen: string, move: RepertoireMove) => {
      const key = normalizeFen(fen)
      setState((s) => {
        const tree = addMoveToTree(s.tree[color], key, move)
        return tree === s.tree[color] ? s : { ...s, tree: { ...s.tree, [color]: tree } }
      })
      pendingAddsRef.current[color].set(`${key}|${move.uci}`, { originFen: key, ...move })
      if (!addFlushScheduledRef.current[color]) {
        addFlushScheduledRef.current[color] = true
        queueMicrotask(() => flushAdds(color))
      }
    },
    [flushAdds],
  )

  const removeMove = useCallback((color: RepertoireColor, fen: string, uci: string) => {
    const key = normalizeFen(fen)
    const id = idsRef.current[color]
    if (id === undefined) return
    setState((s) => {
      const tree = removeMoveFromTree(s.tree[color], color, key, uci)
      return tree === s.tree[color] ? s : { ...s, tree: { ...s.tree, [color]: tree } }
    })
    removeRepertoireMove(id, key, uci).then(
      (tree) => setState((s) => ({ ...s, tree: { ...s.tree, [color]: tree } })),
      (err: unknown) => {
        setState((s) => ({ ...s, error: errorMessage(err) }))
        fetchRepertoireTree(id).then((tree) => setState((s) => ({ ...s, tree: { ...s.tree, [color]: tree } })), () => {})
      },
    )
  }, [])

  const getContinuations = useCallback(
    (color: RepertoireColor, fen: string): RepertoireMove[] => state.tree[color][normalizeFen(fen)] ?? [],
    [state.tree],
  )
  const isMoveSaved = useCallback(
    (color: RepertoireColor, fen: string, uci: string): boolean => getContinuations(color, fen).some((m) => m.uci === uci),
    [getContinuations],
  )

  const clearError = useCallback(() => setState((s) => ({ ...s, error: null })), [])

  return { ...state, getContinuations, isMoveSaved, addMove, removeMove, refresh: load, clearError }
}

export type ImportPromptPhase = 'hidden' | 'prompt' | 'result' | 'error'

export type ImportPromptState = {
  phase: ImportPromptPhase
  counts: ImportSummary | null
  confirm: () => void
  dismiss: () => void
  close: () => void
}

/**
 * One-time offer to migrate the anonymous localStorage repertoire into the
 * backend on first sign-in. Tracked per-user (not just "ever shown") in
 * localStorage, since the same browser could later sign into a different
 * account. Deliberately never clears or overwrites the local copy - it's left
 * as an untouched fallback regardless of whether the user imports, dismisses,
 * or the import call fails (see API_CONTRACT.md's import endpoint).
 */
function useImportPrompt(
  user: AuthUser | null,
  localRepertoire: Repertoire,
  apiReady: boolean,
  onImported: () => void,
): ImportPromptState {
  const [phase, setPhase] = useState<ImportPromptPhase>('hidden')
  const [counts, setCounts] = useState<ImportSummary | null>(null)
  const userId = user?.id ?? null

  useEffect(() => {
    if (userId === null || !apiReady) {
      setPhase('hidden')
      return
    }
    const key = `${IMPORT_STATUS_KEY_PREFIX}${userId}`
    let handled: string | null = null
    try {
      handled = localStorage.getItem(key)
    } catch {
      handled = null
    }
    if (handled) return
    if (isRepertoireEmpty(localRepertoire.white) && isRepertoireEmpty(localRepertoire.black)) {
      // Nothing to offer - mark handled so this doesn't re-check every render.
      try {
        localStorage.setItem(key, 'empty')
      } catch {
        // Best-effort only; worst case this re-evaluates next sign-in.
      }
      return
    }
    setPhase('prompt')
    // Only re-evaluate when the signed-in user or API readiness changes, not on
    // every local-repertoire edit - so making more anonymous edits (or the
    // prompt's own confirm/dismiss) never reopens it mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, apiReady])

  const confirm = useCallback(() => {
    if (userId === null) return
    importRepertoire(localRepertoire).then(
      (result) => {
        setCounts(result)
        setPhase('result')
        try {
          localStorage.setItem(`${IMPORT_STATUS_KEY_PREFIX}${userId}`, 'done')
        } catch {
          // Best-effort only.
        }
        onImported()
      },
      () => setPhase('error'),
    )
  }, [userId, localRepertoire, onImported])

  const dismiss = useCallback(() => {
    if (userId !== null) {
      try {
        localStorage.setItem(`${IMPORT_STATUS_KEY_PREFIX}${userId}`, 'skipped')
      } catch {
        // Best-effort only.
      }
    }
    setPhase('hidden')
  }, [userId])

  const close = useCallback(() => setPhase('hidden'), [])

  return { phase, counts, confirm, dismiss, close }
}

/**
 * Saved repertoire moves, keyed by normalized FEN per color (see AGENTS.md's
 * "position identity via FEN"). Anonymous users get the Phase 2 localStorage
 * store; signed-in users get the backend-backed store, with mutations applied
 * optimistically. `user` should be `useAuth()`'s current user, so the two
 * hooks share one session bootstrap rather than each fetching it separately.
 *
 * The four core methods (`getContinuations`/`isMoveSaved`/`addMove`/
 * `removeMove`) are exactly Phase 2's API, so App.tsx/MoveList need no changes
 * beyond passing `user` in; the extra fields below are additive, for the
 * sign-in-aware header/import UI.
 */
export function useRepertoire(user: AuthUser | null) {
  const isAuthenticated = user !== null
  const local = useLocalRepertoireStore()
  const api = useApiRepertoireStore(isAuthenticated)
  const importPrompt = useImportPrompt(user, local.repertoire, api.status === 'ready', api.refresh)

  const active = isAuthenticated ? api : local

  return {
    getContinuations: active.getContinuations,
    isMoveSaved: active.isMoveSaved,
    addMove: active.addMove,
    removeMove: active.removeMove,
    isSignedIn: isAuthenticated,
    isSyncing: isAuthenticated && api.status === 'loading',
    syncError: isAuthenticated ? api.error : null,
    clearSyncError: api.clearError,
    repertoireIds: isAuthenticated ? api.ids : {},
    importPrompt,
  }
}
