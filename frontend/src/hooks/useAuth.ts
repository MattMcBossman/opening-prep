import { useCallback, useEffect, useState } from 'react'
import {
  describeAuthError,
  fetchSession,
  lichessLoginUrl,
  logout as logoutRequest,
  parseAuthErrorFromSearch,
} from '../lib/authApi'
import type { AuthUser } from '../lib/authApi'

/**
 * Bootstraps and owns sign-in state against the Django backend. The
 * `GET /auth/session/` call this fires on mount doubles as the CSRF-cookie
 * bootstrap (see apiClient) - every mutating request elsewhere in the app
 * (repertoire saves, drill recording) depends on this having run first, so it
 * always fires regardless of whether anything renders sign-in UI.
 */
export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    // The Lichess OAuth round trip ends with the backend 302ing back here; a
    // failure is reported via `?authError=<slug>` rather than a rendered error
    // page (see API_CONTRACT.md). Surface it once, then strip it from the URL
    // so a refresh doesn't keep re-showing it.
    const slug = parseAuthErrorFromSearch(window.location.search)
    if (slug) {
      setAuthError(describeAuthError(slug))
      const url = new URL(window.location.href)
      url.searchParams.delete('authError')
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    }

    let cancelled = false
    fetchSession()
      .then((res) => {
        if (!cancelled) setUser(res.user)
      })
      .catch(() => {
        if (!cancelled) setUser(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // A real browser navigation, not a fetch - see lichessLoginUrl.
  const login = useCallback((next?: string) => {
    window.location.href = lichessLoginUrl(next)
  }, [])

  const logout = useCallback(() => {
    return logoutRequest()
      .catch(() => {
        // Best-effort: even if the request fails (e.g. the session was already
        // gone), still treat the user as signed out locally so the UI doesn't
        // get stuck showing a signed-in state that the server disagrees with.
      })
      .finally(() => setUser(null))
  }, [])

  const dismissAuthError = useCallback(() => setAuthError(null), [])

  return { user, loading, authError, login, logout, dismissAuthError }
}
