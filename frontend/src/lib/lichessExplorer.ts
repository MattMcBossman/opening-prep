import type { ExplorerMoveStat, ExplorerResponse } from '../types'

// As of 2026, Lichess requires a personal API token (Bearer auth) on every Opening
// Explorer request, and the endpoint moved from explorer.lichess.ovh to explorer.lichess.org.
// See https://lichess.org/@/thibault/blog/the-opening-explorer-now-requires-authentication/FSWh9Zg3
const EXPLORER_URL = 'https://explorer.lichess.org/lichess'
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

// MVP in-memory cache, keyed by FEN. This is a stand-in for the FEN-keyed
// PositionStatsCache described in AGENTS.md; a persistent/shared version
// moves to the Django backend in a later phase.
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
