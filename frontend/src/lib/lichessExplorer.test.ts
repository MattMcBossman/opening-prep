import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchExplorerStats,
  fetchExplorerStatsViaBackend,
  fetchLichessExplorer,
  fetchMyGamesExplorerStats,
} from './lichessExplorer'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const RAW_EXPLORER_RESPONSE = {
  white: 100,
  draws: 20,
  black: 80,
  moves: [{ uci: 'e2e4', san: 'e4', white: 60, draws: 10, black: 30 }],
  opening: { eco: 'B90', name: 'Sicilian Defense: Najdorf Variation' },
}

const EXPECTED_RESPONSE = {
  totalGames: 200,
  moves: [{ san: 'e4', uci: 'e2e4', white: 60, draws: 10, black: 30, totalGames: 100 }],
  opening: { eco: 'B90', name: 'Sicilian Defense: Najdorf Variation' },
}

describe('fetchLichessExplorer (anonymous, direct-to-Lichess)', () => {
  it('sends the Bearer token and normalizes the response shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(RAW_EXPLORER_RESPONSE))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchLichessExplorer('some-fen w KQkq -', 'lip_token')

    expect(result).toEqual(EXPECTED_RESPONSE)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('explorer.lichess.org')
    expect(init.headers).toEqual({ Authorization: 'Bearer lip_token' })
  })

  it('throws a readable error on a 401 (bad token)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
    // A distinct FEN from the test above, so this doesn't hit the in-memory
    // cache the previous (successful) request populated.
    await expect(fetchLichessExplorer('unauthorized-fen w KQkq -', 'bad-token')).rejects.toThrow(/rejected the API token/)
  })
})

describe('fetchExplorerStatsViaBackend (signed-in, via the Django proxy)', () => {
  it('requests the backend explorer endpoint with same-origin credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(EXPECTED_RESPONSE))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchExplorerStatsViaBackend('another-fen w KQkq -')

    expect(result).toEqual(EXPECTED_RESPONSE)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/explorer/stats/?fen=another-fen+w+KQkq+-&moves=12')
    expect(init.credentials).toBe('same-origin')
  })

  it('surfaces a 401 (sign-in required, no server fallback token) as an ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ detail: 'Sign in required.' }, { status: 401 })))
    await expect(fetchExplorerStatsViaBackend('third-fen w KQkq -')).rejects.toMatchObject({
      status: 401,
      detail: 'Sign in required.',
    })
  })
})

describe('fetchExplorerStats (chooses signed-in vs anonymous, with 401 fallback)', () => {
  it('goes straight to the direct path when anonymous', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(RAW_EXPLORER_RESPONSE))
    vi.stubGlobal('fetch', fetchMock)

    await fetchExplorerStats('a-fen w KQkq -', { apiToken: 'lip_token', signedIn: false })
    expect(fetchMock.mock.calls[0][0]).toContain('explorer.lichess.org')
  })

  it('uses the backend proxy when signed in', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(EXPECTED_RESPONSE))
    vi.stubGlobal('fetch', fetchMock)

    await fetchExplorerStats('b-fen w KQkq -', { apiToken: '', signedIn: true })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/explorer/stats/?fen=b-fen+w+KQkq+-&moves=12')
  })

  it('falls back to the direct path on a 401 from the backend proxy when a token is pasted', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.startsWith('/api/v1/')) {
        return Promise.resolve(jsonResponse({ detail: 'No Lichess token available.' }, { status: 401 }))
      }
      return Promise.resolve(jsonResponse(RAW_EXPLORER_RESPONSE))
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchExplorerStats('c-fen w KQkq -', { apiToken: 'lip_token', signedIn: true })
    expect(result).toEqual(EXPECTED_RESPONSE)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toContain('explorer.lichess.org')
  })

  it('re-throws a 401 from the backend proxy when there is no pasted token to fall back to', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ detail: 'No Lichess token available.' }, { status: 401 })))

    await expect(fetchExplorerStats('d-fen w KQkq -', { apiToken: '', signedIn: true })).rejects.toMatchObject({
      status: 401,
    })
  })
})

describe('fetchMyGamesExplorerStats (signed-in, own games)', () => {
  it('requests the my-games backend endpoint with the color and same-origin credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(EXPECTED_RESPONSE))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchMyGamesExplorerStats('my-games-fen w KQkq -', 'white')

    expect(result).toEqual(EXPECTED_RESPONSE)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/explorer/my-games/?fen=my-games-fen+w+KQkq+-&moves=12&color=white')
    expect(init.credentials).toBe('same-origin')
  })

  it('passes through stillIndexing when the backend reports one', async () => {
    const indexing = { ...EXPECTED_RESPONSE, stillIndexing: true }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(indexing)))

    const result = await fetchMyGamesExplorerStats('another-my-games-fen w KQkq -', 'black')
    expect(result.stillIndexing).toBe(true)
  })

  it('surfaces a 401 (no linked Lichess account) as an ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ detail: 'Link your Lichess account.' }, { status: 401 })),
    )

    await expect(fetchMyGamesExplorerStats('yet-another-fen w KQkq -', 'white')).rejects.toMatchObject({
      status: 401,
    })
  })
})
