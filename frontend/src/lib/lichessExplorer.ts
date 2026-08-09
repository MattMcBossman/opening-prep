import { ApiError, apiRequest } from './apiClient'
import type { ExplorerMoveStat, ExplorerResponse, RepertoireColor } from '../types'

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

export async function fetchLichessExplorer(
  fen: string,
  apiToken: string,
  signal?: AbortSignal,
): Promise<ExplorerResponse> {
  const cacheKey = `${apiToken ? 'auth' : 'anon'}:${fen}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data
  }

  const url = new URL(EXPLORER_URL)
  url.searchParams.set('fen', fen)
  url.searchParams.set('moves', '12')
  url.searchParams.set('topGames', '0')
  url.searchParams.set('recentGames', '0')

  const res = await fetch(url.toString(), {
    signal,
    headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : undefined,
  })
  if (res.status === 401) {
    throw new Error('Lichess rejected the API token. Check it and try again.')
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
  options: { apiToken: string; signedIn: boolean; signal?: AbortSignal },
): Promise<ExplorerResponse> {
  if (!options.signedIn) {
    return fetchLichessExplorer(fen, options.apiToken, options.signal)
  }
  try {
    return await fetchExplorerStatsViaBackend(fen, options.signal)
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && options.apiToken) {
      return fetchLichessExplorer(fen, options.apiToken, options.signal)
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
export async function fetchExplorerStatsViaBackend(fen: string, signal?: AbortSignal): Promise<ExplorerResponse> {
  const cacheKey = `backend:${fen}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data
  }

  const params = new URLSearchParams({ fen, moves: '12' })
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
  signal?: AbortSignal,
): Promise<ExplorerResponse> {
  const cacheKey = `my-games:${color}:${fen}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data
  }

  const params = new URLSearchParams({ fen, moves: '12', color })
  const data = await apiRequest<ExplorerResponse>(`/explorer/my-games/?${params.toString()}`, { signal })

  cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS })
  return data
}
