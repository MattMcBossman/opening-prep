import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchExplorerStats, fetchMyGamesExplorerStats } from '../lib/lichessExplorer'
import type { LichessDatabaseFilters } from '../lib/lichessExplorer'
import type { ExplorerResponse, RepertoireColor } from '../types'

export type ExplorerSource = 'lichess' | 'my-games'

// Lichess indexes a player's games in the background (see player_stats.py on
// the backend), which can genuinely take longer than one request's wait
// budget - a single "still indexing" response with no further retry just
// looks broken. These bound how long this hook keeps quietly re-polling on
// its own before leaving it to a manual retry.
const MY_GAMES_POLL_INTERVAL_MS = 4000
const MY_GAMES_MAX_POLL_ATTEMPTS = 15

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
 * `myGamesColor` to know which of the user's colors to scope to. While a
 * `my-games` result comes back `stillIndexing`, this hook automatically
 * re-polls every `MY_GAMES_POLL_INTERVAL_MS` (see `isPolling`/`pollExhausted`/
 * `retry` below) rather than leaving a one-shot, seemingly-stuck result.
 *
 * `filters` applies to both sources for `since`/`until`; `ratings`/`speeds`
 * are only meaningful for (and only ever sent for) the `'lichess'` source -
 * see `LichessDatabaseFilters`.
 */
export function useExplorerStats(
  fen: string,
  apiToken: string,
  enabled = true,
  signedIn = false,
  source: ExplorerSource = 'lichess',
  myGamesColor: RepertoireColor = 'white',
  filters?: LichessDatabaseFilters,
) {
  const [data, setData] = useState<ExplorerResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const filtersKey = JSON.stringify(filters ?? {})
  const identityKey = `${fen}|${apiToken}|${enabled}|${signedIn}|${source}|${myGamesColor}|${filtersKey}`

  // A fresh query identity (new position/color/source/token/filters) always
  // starts its own poll-attempt count from zero, rather than inheriting an
  // unrelated query's count. Comparing-and-resetting a ref directly during
  // render (rather than in an effect) is the standard React pattern for
  // "derived state that resets when an input changes" - see the `retry`
  // callback below for the other place this ref is reset.
  const identityRef = useRef(identityKey)
  const attemptRef = useRef(0)
  if (identityRef.current !== identityKey) {
    identityRef.current = identityKey
    attemptRef.current = 0
  }

  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const retry = useCallback(() => {
    attemptRef.current = 0
    setTick((t) => t + 1)
  }, [])

  useEffect(() => {
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current)
      pollTimeoutRef.current = null
    }

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
        ? fetchMyGamesExplorerStats(fen, myGamesColor, controller.signal, filters)
        : fetchExplorerStats(fen, { apiToken, signedIn, signal: controller.signal, filters })

    request
      .then((res) => {
        setData(res)
        setLoading(false)
        if (source === 'my-games' && res.stillIndexing && attemptRef.current < MY_GAMES_MAX_POLL_ATTEMPTS) {
          attemptRef.current += 1
          pollTimeoutRef.current = setTimeout(() => setTick((t) => t + 1), MY_GAMES_POLL_INTERVAL_MS)
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Failed to load explorer stats')
        setLoading(false)
      })

    return () => {
      controller.abort()
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current)
        pollTimeoutRef.current = null
      }
    }
    // identityKey captures every input the request needs (fen/apiToken/enabled/
    // signedIn/source/myGamesColor/filters); `tick` is what actually drives
    // re-fetching for polling/retry without those inputs having changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey, tick])

  const stillIndexing = source === 'my-games' && Boolean(data?.stillIndexing)

  return {
    data,
    loading,
    error,
    /** True while automatically re-polling a `my-games` result that's still indexing on Lichess's side. */
    isPolling: stillIndexing && attemptRef.current < MY_GAMES_MAX_POLL_ATTEMPTS,
    /** True once automatic re-polling has given up (still indexing after `MY_GAMES_MAX_POLL_ATTEMPTS`) - offer a manual `retry`. */
    pollExhausted: stillIndexing && attemptRef.current >= MY_GAMES_MAX_POLL_ATTEMPTS,
    /** Restarts the poll-attempt count and re-fetches immediately - for a manual "Try again" once auto-polling has given up. */
    retry,
  }
}
