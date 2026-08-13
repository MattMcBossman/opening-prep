import { useCallback, useState } from 'react'

const STORAGE_KEY = 'opening-prep:tutorial:v1'

function shouldOpenGuide(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === null
  } catch {
    // Storage can be unavailable in private or locked-down browsing contexts.
    // The guide still works for the current page; it just cannot remember dismissal.
    return true
  }
}

export function useMainlineGuide() {
  const [open, setOpen] = useState(shouldOpenGuide)

  const show = useCallback(() => setOpen(true), [])
  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, 'dismissed')
    } catch {
      // Best-effort browser-local preference.
    }
    setOpen(false)
  }, [])

  return { open, show, dismiss }
}
