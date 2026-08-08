import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDrillSession, finishDrillSession, submitDrillAttempts } from './drillsApi'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createDrillSession', () => {
  it('POSTs the repertoire id and retry-pass flag', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 7, startedAt: '2026-01-01T00:00:00Z' }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await createDrillSession(1, false)
    expect(result).toEqual({ id: 7, startedAt: '2026-01-01T00:00:00Z' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/drills/sessions/')
    expect(JSON.parse(init.body)).toEqual({ repertoireId: 1, isRetryPass: false })
  })
})

describe('submitDrillAttempts', () => {
  it('POSTs a batch of attempts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const attempts = [
      { originFen: 'x', playedUci: 'e2e4', isCorrect: false, attemptNumber: 2, lineId: 'e2e4 e7e5', cpLoss: 120, isBad: true },
    ]
    await submitDrillAttempts(7, attempts)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/drills/sessions/7/attempts/')
    expect(JSON.parse(init.body)).toEqual({ attempts })
  })
})

describe('finishDrillSession', () => {
  it('POSTs per-line outcomes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 7 }))
    vi.stubGlobal('fetch', fetchMock)

    const results = [{ lineId: 'e2e4 e7e5', outcome: 'perfect' as const }]
    await finishDrillSession(7, results)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/drills/sessions/7/finish/')
    expect(JSON.parse(init.body)).toEqual({ results })
  })
})
