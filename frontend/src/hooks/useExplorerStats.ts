import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchExplorerStats, fetchMyGamesExplorerStats } from '../lib/lichessExplorer'
import type { LichessDatabaseFilters } from '../lib/lichessExplorer'
import type { ExplorerResponse, RepertoireColor } from '../types'

export type ExplorerSource = 'lichess' | 'my-games'

function mergeExplorerResponses(responses: ExplorerResponse[]): ExplorerResponse {
  const rows = new Map<string, ExplorerResponse['moves'][number]>()
  for (const response of responses) {
    for (const move of response.moves) {
      const existing = rows.get(move.uci)
      rows.set(move.uci, existing ? {
        ...existing,
        white: existing.white + move.white,
        draws: existing.draws + move.draws,
        black: existing.black + move.black,
        totalGames: existing.totalGames + move.totalGames,
      } : { ...move })
    }
  }
  const indexing = responses.find((response) => response.stillIndexing)
  return {
    totalGames: responses.reduce((total, response) => total + response.totalGames, 0),
    moves: [...rows.values()].sort((a, b) => b.totalGames - a.totalGames).slice(0, 12),
    opening: responses.find((response) => response.opening)?.opening ?? null,
    ...(indexing ? { stillIndexing: true } : {}),
    ...(indexing?.queuePosition !== undefined ? { queuePosition: indexing.queuePosition } : {}),
  }
}

// Lichess indexes a player's games in the background (see player_stats.py on
// the backend), which can genuinely take longer than one request's wait
// budget - a single "still indexing" response with no further retry just
// looks broken. These bound how long this hook keeps quietly re-polling on
// its own before leaving it to a manual retry.
const MY_GAMES_POLL_INTERVAL_MS = 4000
// A first-time Chess.com history index can span years of monthly archives.
// Keep progressing it in the background for up to four minutes; later
// positions are SQL lookups and normally settle immediately.
const MY_GAMES_MAX_POLL_ATTEMPTS = 60

/**
 * Fetches Lichess explorer stats for `fen`. `enabled` lets a caller that only
 * wants stats for *some* positions (e.g. drills, which only show them once a
 * line is finished - showing them earlier would hint at the prepared move) skip
 * the request entirely rather than burning an API call per position visited.
 *
 * `signedIn` routes through the backend's caching proxy using the linked
 * account's stored Lichess token. Signed-out users are prompted to sign in and
 * link Lichess rather than being asked to create and paste an API token.
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
  userId?: number,
  lichessConnectionKey = '',
) {
  const [data, setData] = useState<ExplorerResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resultIdentity, setResultIdentity] = useState<string | null>(null)
  const [snapshotStable, setSnapshotStable] = useState(false)
  const [tick, setTick] = useState(0)

  const filtersKey = JSON.stringify(filters ?? {})
  const identityKey = `${fen}|${apiToken}|${enabled}|${signedIn}|${source}|${myGamesColor}|${filtersKey}|${userId ?? ''}|${lichessConnectionKey}`

  // A fresh query identity (new position/color/source/token/filters) always
  // starts its own poll-attempt count from zero, rather than inheriting an
  // unrelated query's count. Comparing-and-resetting a ref directly during
  // render (rather than in an effect) is the standard React pattern for
  // "derived state that resets when an input changes" - see the `retry`
  // callback below for the other place this ref is reset.
  const identityRef = useRef(identityKey)
  const attemptRef = useRef(0)
  const snapshotFingerprintRef = useRef<string | null>(null)
  const sourceResultsRef = useRef(new Map<string, ExplorerResponse>())
  if (identityRef.current !== identityKey) {
    identityRef.current = identityKey
    attemptRef.current = 0
    snapshotFingerprintRef.current = null
    sourceResultsRef.current.clear()
  }

  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const retry = useCallback(() => {
    attemptRef.current = 0
    snapshotFingerprintRef.current = null
    setSnapshotStable(false)
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
      setResultIdentity(identityKey)
      return
    }

    if (source === 'lichess' && !signedIn) {
      setData(null)
      setLoading(false)
      setError('Sign in and link a Lichess account to load explorer data.')
      setResultIdentity(identityKey)
      return
    }

    if (source === 'my-games' && !signedIn) {
      setData(null)
      setLoading(false)
      setError('Sign in to link a Lichess or Chess.com account and view your own game history.')
      setResultIdentity(identityKey)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    const selectedDatabases = filters?.databases ?? ['lichess', 'chesscom']
    const requests = source === 'my-games'
      ? selectedDatabases.map((database) => ({ key: database, request: fetchMyGamesExplorerStats(
          fen,
          myGamesColor,
          userId ?? 0,
          controller.signal,
          { ...filters, databases: [database] },
        ) }))
      : [{ key: 'public', request: fetchExplorerStats(fen, { apiToken, signedIn, signal: controller.signal, filters }) }]
    let failures = 0
    let settled = 0
    let latestMerged: ExplorerResponse | null = null

    const finishRequest = () => {
      settled += 1
      if (
        settled === requests.length
        && source === 'my-games'
        && latestMerged?.stillIndexing
        && attemptRef.current < MY_GAMES_MAX_POLL_ATTEMPTS
      ) {
        attemptRef.current += 1
        pollTimeoutRef.current = setTimeout(() => setTick((t) => t + 1), MY_GAMES_POLL_INTERVAL_MS)
      }
    }

    const publish = (key: string, res: ExplorerResponse) => {
      sourceResultsRef.current.set(key, res)
      const merged = mergeExplorerResponses([...sourceResultsRef.current.values()])
      if (sourceResultsRef.current.size + failures < requests.length) merged.stillIndexing = true
      latestMerged = merged
      setData(merged)
      setResultIdentity(identityKey)
      setLoading(false)
      const fingerprint = JSON.stringify({
        totalGames: merged.totalGames,
        moves: merged.moves.map((move) => [move.uci, move.white, move.draws, move.black]),
      })
      const unchangedPartial = Boolean(merged.stillIndexing && snapshotFingerprintRef.current === fingerprint)
      snapshotFingerprintRef.current = fingerprint
      setSnapshotStable(unchangedPartial || !merged.stillIndexing)
    }

    requests.forEach(({ key, request }) => request
      .then((res) => {
        if (!controller.signal.aborted) {
          publish(key, res)
          finishRequest()
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        failures += 1
        finishRequest()
        if (failures === requests.length) {
          setError(err instanceof Error ? err.message : 'Failed to load explorer stats')
          setResultIdentity(identityKey)
          setLoading(false)
        }
      }))

    return () => {
      controller.abort()
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current)
        pollTimeoutRef.current = null
      }
    }
    // identityKey captures every input the request needs (fen/apiToken/enabled/
    // signedIn/source/myGamesColor/filters/user/connection); `tick` drives
    // re-fetching for polling/retry without those inputs having changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey, tick])

  // A source/position/filter switch must never render the previous query's
  // table while the next request is starting. Poll ticks retain the latest
  // partial snapshot because their identity is deliberately unchanged.
  const visibleData = resultIdentity === identityKey ? data : null
  const visibleError = resultIdentity === identityKey ? error : null
  const visibleLoading = loading || resultIdentity !== identityKey
  const stillIndexing = source === 'my-games' && Boolean(visibleData?.stillIndexing)

  return {
    data: visibleData,
    loading: visibleLoading,
    error: visibleError,
    /** True while automatically re-polling a `my-games` result that's still indexing on Lichess's side. */
    isPolling: stillIndexing && !snapshotStable && attemptRef.current < MY_GAMES_MAX_POLL_ATTEMPTS,
    /** True once automatic re-polling has given up (still indexing after `MY_GAMES_MAX_POLL_ATTEMPTS`) - offer a manual `retry`. */
    pollExhausted: stillIndexing && attemptRef.current >= MY_GAMES_MAX_POLL_ATTEMPTS,
    /** Restarts the poll-attempt count and re-fetches immediately - for a manual "Try again" once auto-polling has given up. */
    retry,
  }
}
