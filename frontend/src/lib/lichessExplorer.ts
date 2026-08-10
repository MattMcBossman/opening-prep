import { ApiError, apiRequest } from './apiClient'
import type { ExplorerMoveStat, ExplorerResponse, RepertoireColor } from '../types'
import { normalizeFen } from './chessUtils'
import { recordClientCacheMetric } from './cacheMetrics'

// As of 2026, Lichess requires a personal API token (Bearer auth) on every Opening
// Explorer request, and the endpoint moved from explorer.lichess.ovh to explorer.lichess.org.
// See https://lichess.org/@/thibault/blog/the-opening-explorer-now-requires-authentication/FSWh9Zg3
const EXPLORER_URL = 'https://explorer.lichess.org/lichess'
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

// In-memory cache, keyed by FEN (and, for the direct path, by whether a token
// was used - see `fetchLichessExplorer`). Signed-in requests also hit the
// backend's own FEN-keyed PositionStatsCache (see API_CONTRACT.md) - this is
// just the client-side layer on top, avoiding a round trip at all for a FEN
// already fetched this session.
const cache = new Map<string, { data: ExplorerResponse; expiresAt: number }>()

type RawExplorerMove = {
  uci: string
  san: string
  white?: number
  draws?: number
  black?: number
}

type RawExplorerResponse = {
  white?: number
  draws?: number
  black?: number
  moves?: RawExplorerMove[]
  opening?: { eco: string; name: string } | null
}

/** `since`/`until` are Lichess's own "YYYY-MM" month format, applicable to every explorer source. */
export type TimeRangeFilters = {
  since?: string
  until?: string
}

/**
 * Explorer filters. Rating bands are supported only by Lichess's public
 * `/lichess` database; game speeds are supported by both `/lichess` and the
 * player-scoped `/player` endpoint. `ratings` are Lichess's bracket markers ("1600",
 * "1800", "2000", "2200", "2500"); `speeds` are perf types ("bullet",
 * "blitz", etc). An empty/omitted array means "no restriction", matching
 * today's unfiltered behavior.
 */
export type LichessDatabaseFilters = TimeRangeFilters & {
  ratings?: string[]
  speeds?: string[]
}

/** Stable cache-key fragment for a filters object, order-independent so equivalent filter sets share a cache entry. */
function filterKey(filters?: Record<string, string | string[] | undefined>): string {
  if (!filters) return ''
  return Object.entries(filters)
    .filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? [...v].sort().join(',') : v}`)
    .sort()
    .join('&')
}

function applyTimeRangeFilters(params: URLSearchParams, filters?: TimeRangeFilters): void {
  // Both explorer endpoints accept YYYY-MM. Slicing also keeps this boundary
  // tolerant of older in-memory values created by the brief date-picker UI.
  if (filters?.since) params.set('since', filters.since.slice(0, 7))
  if (filters?.until) params.set('until', filters.until.slice(0, 7))
}

function applyPlayerFilters(params: URLSearchParams, filters?: LichessDatabaseFilters): void {
  applyTimeRangeFilters(params, filters)
  if (filters?.speeds?.length) params.set('speeds', filters.speeds.join(','))
}

function applyLichessDatabaseFilters(params: URLSearchParams, filters?: LichessDatabaseFilters): void {
  applyPlayerFilters(params, filters)
  if (filters?.ratings?.length) params.set('ratings', filters.ratings.join(','))
}

export async function fetchLichessExplorer(
  fen: string,
  apiToken: string,
  signal?: AbortSignal,
  filters?: LichessDatabaseFilters,
): Promise<ExplorerResponse> {
  const cacheKey = `${apiToken ? 'auth' : 'anon'}:${normalizeFen(fen)}:${filterKey(filters)}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    recordClientCacheMetric('explorerHit')
    return cached.data
  }
  recordClientCacheMetric('explorerMiss')

  const url = new URL(EXPLORER_URL)
  url.searchParams.set('fen', fen)
  url.searchParams.set('moves', '12')
  url.searchParams.set('topGames', '0')
  url.searchParams.set('recentGames', '0')
  applyLichessDatabaseFilters(url.searchParams, filters)

  const res = await fetch(url.toString(), {
    signal,
    headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : undefined,
  })
  if (res.status === 401) {
    throw new Error('Lichess rejected the API token. Check it and try again.')
  }
  if (res.status === 429) {
    const parsed = Number.parseInt(res.headers.get('Retry-After') ?? '', 10)
    throw new ApiError(429, 'Lichess rate-limited this request.', null, Number.isFinite(parsed) ? parsed : null)
  }
  if (!res.ok) {
    throw new Error(`Lichess explorer request failed: ${res.status}`)
  }
  const raw: RawExplorerResponse = await res.json()

  const moves: ExplorerMoveStat[] = (raw.moves ?? []).map((m) => {
    const white = m.white ?? 0
    const draws = m.draws ?? 0
    const black = m.black ?? 0
    return { san: m.san, uci: m.uci, white, draws, black, totalGames: white + draws + black }
  })

  const data: ExplorerResponse = {
    totalGames: (raw.white ?? 0) + (raw.draws ?? 0) + (raw.black ?? 0),
    moves,
    opening: raw.opening ? { eco: raw.opening.eco, name: raw.opening.name } : null,
  }

  cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS })
  return data
}

/**
 * Chooses the signed-in (backend proxy) or anonymous (direct-to-Lichess) path
 * and falls back from the former to the latter on a 401 - the explorer proxy's
 * one hand-built 401 means "no usable Lichess token to call upstream with"
 * (distinct from DRF's stock 403 for "not authenticated" - see
 * API_CONTRACT.md), so if the user has also pasted a token, prefer using it
 * over failing outright. See useExplorerStats.
 */
export async function fetchExplorerStats(
  fen: string,
  options: { apiToken: string; signedIn: boolean; signal?: AbortSignal; filters?: LichessDatabaseFilters },
): Promise<ExplorerResponse> {
  if (!options.signedIn) {
    return fetchLichessExplorer(fen, options.apiToken, options.signal, options.filters)
  }
  try {
    return await fetchExplorerStatsViaBackend(fen, options.signal, options.filters)
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && options.apiToken) {
      return fetchLichessExplorer(fen, options.apiToken, options.signal, options.filters)
    }
    throw err
  }
}

/**
 * Signed-in path: routes through the backend's caching proxy instead of
 * calling Lichess directly, so the server-held Lichess token (not a pasted
 * one) is used and repeated FEN lookups can share the server-side cache across
 * users. The response shape already matches `ExplorerResponse` (see
 * API_CONTRACT.md), so no reshaping is needed. Shares the same in-memory
 * client cache as the anonymous path, under a distinct key prefix so the two
 * paths never collide if a user signs in/out mid-session.
 */
export async function fetchExplorerStatsViaBackend(
  fen: string,
  signal?: AbortSignal,
  filters?: LichessDatabaseFilters,
): Promise<ExplorerResponse> {
  const cacheKey = `backend:${normalizeFen(fen)}:${filterKey(filters)}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    recordClientCacheMetric('explorerHit')
    return cached.data
  }
  recordClientCacheMetric('explorerMiss')

  const params = new URLSearchParams({ fen, moves: '12' })
  applyLichessDatabaseFilters(params, filters)
  const data = await apiRequest<ExplorerResponse>(`/explorer/stats/?${params.toString()}`, { signal })

  cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS })
  return data
}

/**
 * Opening-tree stats built from the signed-in user's own Lichess games (see
 * API_CONTRACT.md's `/explorer/my-games/`), for `color` (the color the user
 * played, matching the app's repertoire toggle - not whose turn it is at
 * `fen`). Always authenticated server-side; there is no anonymous fallback,
 * unlike `fetchExplorerStats`. A short-lived in-memory cache mirrors the
 * other paths above, keyed by color as well as FEN since the two colors'
 * results are unrelated.
 */
export async function fetchMyGamesExplorerStats(
  fen: string,
  color: RepertoireColor,
  userId: number,
  signal?: AbortSignal,
  filters?: LichessDatabaseFilters,
): Promise<ExplorerResponse> {
  const cacheKey = `my-games:${userId}:${color}:${normalizeFen(fen)}:${filterKey(filters)}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    recordClientCacheMetric('explorerHit')
    return cached.data
  }
  recordClientCacheMetric('explorerMiss')

  const params = new URLSearchParams({ fen, moves: '12', color })
  applyPlayerFilters(params, filters)
  const data = await apiRequest<ExplorerResponse>(`/explorer/my-games/?${params.toString()}`, { signal })

  // Never cache a still-indexing result: Lichess hasn't finished computing it
  // yet, so caching it (even briefly) would show a stale "no data" result on
  // the next poll instead of letting useExplorerStats's retry loop see
  // whatever progress Lichess has made since. A finished result is still
  // cached normally.
  if (!data.stillIndexing) {
    cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS })
  }
  return data
}
