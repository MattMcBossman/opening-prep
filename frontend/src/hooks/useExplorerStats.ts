import { useEffect, useState } from 'react'
import { fetchExplorerStats, fetchMyGamesExplorerStats } from '../lib/lichessExplorer'
import type { ExplorerResponse, RepertoireColor } from '../types'

export type ExplorerSource = 'lichess' | 'my-games'

/**
 * Fetches Lichess explorer stats for `fen`. `enabled` lets a caller that only
 * wants stats for *some* positions (e.g. drills, which only show them once a
 * line is finished - showing them earlier would hint at the prepared move) skip
 * the request entirely rather than burning an API call per position visited.
 *
 * `signedIn` routes through the backend's caching proxy (using the account's
 * stored Lichess token) instead of the anonymous direct-to-Lichess path with a
 * pasted `apiToken` - see lichessExplorer.ts's `fetchExplorerStats`. `apiToken`
 * is otherwise unused while signed in, except as a fallback if the backend
 * proxy reports it has no usable token of its own.
 *
 * `source: 'my-games'` switches to the signed-in user's own Lichess games
 * instead of the public database (see `fetchMyGamesExplorerStats`) - this
 * path is always backend-only (no anonymous/token fallback) and needs
 * `myGamesColor` to know which of the user's colors to scope to.
 */
export function useExplorerStats(
  fen: string,
  apiToken: string,
  enabled = true,
  signedIn = false,
  source: ExplorerSource = 'lichess',
  myGamesColor: RepertoireColor = 'white',
) {
  const [data, setData] = useState<ExplorerResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      // Back to the pre-fetch state (rather than "loaded nothing"), so the first
      // render after re-enabling shows "Loading…" instead of briefly flashing
      // "No Lichess game data" before the fetch effect runs.
      setData(null)
      setLoading(true)
      setError(null)
      return
    }

    if (source === 'lichess' && !signedIn && !apiToken) {
      setData(null)
      setLoading(false)
      setError('Add a Lichess API token to load explorer stats.')
      return
    }

    if (source === 'my-games' && !signedIn) {
      setData(null)
      setLoading(false)
      setError('Sign in with Lichess to see stats from your own games.')
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    const request =
      source === 'my-games'
        ? fetchMyGamesExplorerStats(fen, myGamesColor, controller.signal)
        : fetchExplorerStats(fen, { apiToken, signedIn, signal: controller.signal })

    request
      .then((res) => {
        setData(res)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Failed to load explorer stats')
        setLoading(false)
      })

    return () => controller.abort()
  }, [fen, apiToken, enabled, signedIn, source, myGamesColor])

  return { data, loading, error }
}
