import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiRequest } from './apiClient'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('apiRequest', () => {
  it('uses the /api/v1 base path and same-origin credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiRequest('/auth/session/')).resolves.toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/session/', expect.objectContaining({ credentials: 'same-origin' }))
  })

  it('adds JSON and CSRF headers on unsafe methods', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('document', { cookie: 'csrftoken=abc123; other=value' })

    await apiRequest('/auth/logout/', { method: 'POST', body: { yes: true } })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/logout/',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': 'abc123' },
        body: JSON.stringify({ yes: true }),
      }),
    )
  })

  it('throws typed ApiError failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ detail: 'Nope' }, { status: 401 })))

    await expect(apiRequest('/private/')).rejects.toMatchObject(new ApiError(401, 'Nope'))
  })

  it('preserves DRF field validation errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ color: ['Invalid'] }, { status: 400 })))

    await expect(apiRequest('/repertoires/', { method: 'POST', body: { color: 'red' } })).rejects.toMatchObject({
      status: 400,
      detail: 'Request failed: 400',
      fieldErrors: { color: ['Invalid'] },
    })
  })

  it('preserves Retry-After seconds on rate limits', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(
      { detail: 'Slow down' },
      { status: 429, headers: { 'Retry-After': '17' } },
    )))

    await expect(apiRequest('/explorer/stats/')).rejects.toMatchObject({ status: 429, retryAfterSeconds: 17 })
  })

  it('returns undefined for 204 responses without parsing JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))

    await expect(apiRequest('/auth/logout/', { method: 'POST' })).resolves.toBeUndefined()
  })
})
