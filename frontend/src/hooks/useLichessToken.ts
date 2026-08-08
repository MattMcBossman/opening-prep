import { useCallback, useState } from 'react'

const STORAGE_KEY = 'opening-prep:lichess-api-token'

/**
 * Lichess now requires a personal API token on every Opening Explorer request
 * (see lib/lichessExplorer.ts). This is a client-only stand-in until account
 * linking exists (Phase 2+): the token is stored in this browser only.
 */
export function useLichessToken() {
  const [token, setTokenState] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? ''
    } catch {
      return ''
    }
  })

  const setToken = useCallback((value: string) => {
    setTokenState(value)
    try {
      if (value) {
        localStorage.setItem(STORAGE_KEY, value)
      } else {
        localStorage.removeItem(STORAGE_KEY)
      }
    } catch {
      // localStorage may be unavailable (e.g. private browsing); token still works for this session.
    }
  }, [])

  return { token, setToken }
}
