import { useCallback, useLayoutEffect, useState } from 'react'

const STORAGE_KEY = 'opening-prep:theme'

export type Theme = 'light' | 'dark'

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // localStorage may be unavailable (e.g. private browsing); use the app default.
  }
  return 'dark'
}

/**
 * Temporary, whole-app theme toggle (light/dark). Persisted in localStorage; this is a
 * placeholder until user settings exist, at which point it should move there.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme)

  // useLayoutEffect (not useEffect) so the attribute is applied before the browser
  // paints, avoiding a flash of the wrong theme on first load.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === 'light' ? 'dark' : 'light'
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // Best-effort persistence only.
      }
      return next
    })
  }, [])

  return { theme, toggleTheme }
}
