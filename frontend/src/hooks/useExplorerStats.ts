import { useEffect, useState } from 'react'
import { fetchExplorerStats } from '../lib/lichessExplorer'
import type { ExplorerResponse } from '../types'

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
 */
export function useExplorerStats(fen: string, apiToken: string, enabled = true, signedIn = false) {
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

    if (!signedIn && !apiToken) {
      setData(null)
      setLoading(false)
      setError('Add a Lichess API token to load explorer stats.')
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    fetchExplorerStats(fen, { apiToken, signedIn, signal: controller.signal })
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
  }, [fen, apiToken, enabled, signedIn])

  return { data, loading, error }
}
