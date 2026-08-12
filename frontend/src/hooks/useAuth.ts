import { useCallback, useEffect, useState } from 'react'
import {
  describeAuthError,
  cancelLichessMerge as cancelLichessMergeRequest,
  confirmLichessMerge as confirmLichessMergeRequest,
  fetchLichessMerge,
  fetchSession,
  googleLoginUrl,
  lichessLoginUrl,
  linkChessCom as linkChessComRequest,
  logout as logoutRequest,
  parseAuthErrorFromSearch,
  unlinkChessCom as unlinkChessComRequest,
} from '../lib/authApi'
import type { AuthUser } from '../lib/authApi'
import type { LichessMergePreview } from '../lib/authApi'

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
  const [lichessMerge, setLichessMerge] = useState<LichessMergePreview | null>(null)
  const [lichessMergeBusy, setLichessMergeBusy] = useState(false)
  const [lichessMergeError, setLichessMergeError] = useState<string | null>(null)

  useEffect(() => {
    // The Lichess OAuth round trip ends with the backend 302ing back here; a
    // failure is reported via `?authError=<slug>` rather than a rendered error
    // page (see API_CONTRACT.md). Surface it once, then strip it from the URL
    // so a refresh doesn't keep re-showing it.
    const params = new URLSearchParams(window.location.search)
    const slug = parseAuthErrorFromSearch(window.location.search)
    const hasLichessMerge = params.get('accountMerge') === 'lichess'
    if (slug) {
      setAuthError(describeAuthError(slug))
      const url = new URL(window.location.href)
      url.searchParams.delete('authError')
      url.searchParams.delete('accountMerge')
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    } else if (hasLichessMerge) {
      const url = new URL(window.location.href)
      url.searchParams.delete('accountMerge')
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    }

    let cancelled = false
    fetchSession()
      .then((res) => {
        if (!cancelled) setUser(res.user)
        // Also probe when the signed-in user has no Lichess identity. This
        // recovers a pending merge after refresh and survives React Strict
        // Mode's development-only effect replay, which can consume the
        // one-time URL marker before the first request finishes.
        if (!cancelled && res.user && (hasLichessMerge || !res.user.lichessUsername)) {
          return fetchLichessMerge().then((preview) => {
            if (!cancelled) setLichessMerge(preview)
          }).catch((reason) => {
            if (!cancelled && hasLichessMerge) {
              setLichessMergeError(reason instanceof Error ? reason.message : 'The pending account merge could not be loaded.')
            }
          })
        }
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

  const loginWithGoogle = useCallback((next?: string) => {
    window.location.href = googleLoginUrl(next)
  }, [])

  const linkLichess = useCallback((next?: string) => {
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

  const linkChessCom = useCallback(async (username: string) => {
    const updatedUser = await linkChessComRequest(username)
    setUser(updatedUser)
  }, [])

  const unlinkChessCom = useCallback(async () => {
    await unlinkChessComRequest()
    setUser((current) => current ? { ...current, chessComUsername: null } : current)
  }, [])

  const confirmLichessMerge = useCallback(async () => {
    setLichessMergeBusy(true)
    setLichessMergeError(null)
    try {
      const updatedUser = await confirmLichessMergeRequest()
      setUser(updatedUser)
      setLichessMerge(null)
    } catch (reason) {
      setLichessMergeError(reason instanceof Error ? reason.message : 'The accounts could not be merged.')
    } finally {
      setLichessMergeBusy(false)
    }
  }, [])

  const cancelLichessMerge = useCallback(async () => {
    setLichessMergeBusy(true)
    setLichessMergeError(null)
    try {
      await cancelLichessMergeRequest()
      setLichessMerge(null)
    } catch (reason) {
      setLichessMergeError(reason instanceof Error ? reason.message : 'The pending merge could not be canceled.')
    } finally {
      setLichessMergeBusy(false)
    }
  }, [])

  return {
    user,
    loading,
    authError,
    loginWithGoogle,
    linkLichess,
    logout,
    dismissAuthError,
    linkChessCom,
    unlinkChessCom,
    lichessMerge,
    lichessMergeBusy,
    lichessMergeError,
    confirmLichessMerge,
    cancelLichessMerge,
  }
}
