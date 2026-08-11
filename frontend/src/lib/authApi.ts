import { API_BASE, apiRequest } from './apiClient'

export type AuthUser = {
  id: number
  username: string
  lichessUsername: string
  chessComUsername: string | null
}

export type SessionResponse = {
  authenticated: boolean
  user: AuthUser | null
}

/**
 * Anonymous-safe bootstrap call: fetches the current session state AND ensures
 * the CSRF cookie is set (see apiClient), so every mutating request elsewhere
 * in the app depends on this having run first - see useAuth.
 */
export function fetchSession(signal?: AbortSignal): Promise<SessionResponse> {
  return apiRequest('/auth/session/', { signal })
}

export function logout(): Promise<void> {
  return apiRequest('/auth/logout/', { method: 'POST' })
}

export function linkChessCom(username: string): Promise<AuthUser> {
  return apiRequest('/auth/chess-com/', { method: 'PUT', body: { username } })
}

export function unlinkChessCom(): Promise<void> {
  return apiRequest('/auth/chess-com/', { method: 'DELETE' })
}

/**
 * `GET /auth/lichess/start/` is not an XHR endpoint - it 302s straight to
 * Lichess, so callers must navigate the browser there rather than fetching it
 * (see useAuth's `login`). `next` is recorded server-side for the post-login
 * redirect and must be a relative in-app path (see API_CONTRACT.md).
 */
export function lichessLoginUrl(next?: string): string {
  const params = new URLSearchParams()
  if (next) params.set('next', next)
  const query = params.toString()
  return `${API_BASE}/auth/lichess/start/${query ? `?${query}` : ''}`
}

/** Extracts the `?authError=<slug>` param the OAuth callback redirects with on failure. */
export function parseAuthErrorFromSearch(search: string): string | null {
  return new URLSearchParams(search).get('authError')
}

// Slugs are the backend's - see accounts/urls.py's callback view. Deliberately
// permissive: an unrecognized slug still shows a generic message rather than
// nothing at all.
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  state_mismatch: 'The sign-in request expired or was tampered with. Please try again.',
  missing_code: 'Lichess did not return a sign-in code. Please try again.',
  oauth_failed: 'Lichess sign-in failed. Please try again.',
}

export function describeAuthError(slug: string): string {
  return AUTH_ERROR_MESSAGES[slug] ?? 'Sign-in failed. Please try again.'
}
