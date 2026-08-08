import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeAuthError, fetchSession, lichessLoginUrl, logout, parseAuthErrorFromSearch } from './authApi'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('lichessLoginUrl', () => {
  it('points at the anonymous-safe start endpoint with no query when there is no next path', () => {
    expect(lichessLoginUrl()).toBe('/api/v1/auth/lichess/start/')
  })

  it('records a relative next path as a query param', () => {
    expect(lichessLoginUrl('/drills')).toBe('/api/v1/auth/lichess/start/?next=%2Fdrills')
  })
})

describe('parseAuthErrorFromSearch', () => {
  it('extracts the authError slug from a query string', () => {
    expect(parseAuthErrorFromSearch('?authError=state_mismatch')).toBe('state_mismatch')
  })

  it('returns null when there is no authError param', () => {
    expect(parseAuthErrorFromSearch('?next=/drills')).toBeNull()
    expect(parseAuthErrorFromSearch('')).toBeNull()
  })
})

describe('describeAuthError', () => {
  it('maps known slugs to a readable message', () => {
    expect(describeAuthError('state_mismatch')).toMatch(/expired or was tampered/)
  })

  it('falls back to a generic message for an unrecognized slug', () => {
    expect(describeAuthError('something_new')).toBe('Sign-in failed. Please try again.')
  })
})

describe('fetchSession / logout', () => {
  it('fetchSession calls the anonymous-safe session endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ authenticated: false, user: null }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchSession()).resolves.toEqual({ authenticated: false, user: null })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/session/', expect.objectContaining({ credentials: 'same-origin' }))
  })

  it('logout POSTs to the logout endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('document', { cookie: 'csrftoken=tok' })

    await logout()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/logout/', expect.objectContaining({ method: 'POST' }))
  })
})
