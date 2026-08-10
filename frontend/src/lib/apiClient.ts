export const API_BASE = '/api/v1'

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export class ApiError extends Error {
  status: number
  detail: string
  fieldErrors: Record<string, unknown> | null
  retryAfterSeconds: number | null

  constructor(status: number, detail: string, fieldErrors: Record<string, unknown> | null = null, retryAfterSeconds: number | null = null) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
    this.fieldErrors = fieldErrors
    this.retryAfterSeconds = retryAfterSeconds
  }
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

export type ApiRequestOptions = {
  method?: string
  body?: unknown
  signal?: AbortSignal
}

/**
 * Session-cookie auth is intentionally centralized here so endpoint-specific
 * modules don't each need to remember the same-origin credentials/CSRF pairing.
 * The CSRF cookie is created by the anonymous-safe auth/session bootstrap call.
 */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (UNSAFE_METHODS.has(method)) {
    const csrfToken = readCookie('csrftoken')
    if (csrfToken) headers['X-CSRFToken'] = csrfToken
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  })

  if (res.status === 204) {
    return undefined as T
  }

  const isJson = res.headers.get('content-type')?.includes('application/json') ?? false
  const payload: unknown = isJson ? await res.json().catch(() => null) : null

  if (!res.ok) {
    const detail =
      payload && typeof payload === 'object' && 'detail' in payload && typeof payload.detail === 'string'
        ? payload.detail
        : `Request failed: ${res.status}`
    const fieldErrors =
      payload && typeof payload === 'object' && !('detail' in payload) ? (payload as Record<string, unknown>) : null
    const retryAfter = res.headers.get('Retry-After')
    const retryAfterSeconds = retryAfter === null ? null : Number.parseInt(retryAfter, 10)
    throw new ApiError(res.status, detail, fieldErrors, Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null)
  }

  return payload as T
}
