import { useCallback, useState } from 'react'
import { getSoundPlayer } from '../audio/soundPlayer'
import { classifyMoveSound } from '../lib/moveSounds'

const STORAGE_KEY = 'opening-prep:sound'

function getInitialSoundEnabled(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'on') return true
    if (stored === 'off') return false
  } catch {
    // localStorage may be unavailable (e.g. private browsing); fall back to the default.
  }
  return true
}

/**
 * Whether move audio is enabled, plus the one call site needs: play the cue for a move.
 *
 * Persisted in localStorage like the theme and board-color preferences, and for the
 * same reason - it belongs in user settings once those exist, but there's nowhere to
 * put it yet.
 */
export function useSound() {
  const [soundEnabled, setSoundEnabledState] = useState<boolean>(getInitialSoundEnabled)

  const setSoundEnabled = useCallback((next: boolean) => {
    setSoundEnabledState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off')
    } catch {
      // Best-effort persistence only.
    }
  }, [])

  const toggleSound = useCallback(() => {
    setSoundEnabled(!soundEnabled)
  }, [soundEnabled, setSoundEnabled])

  /** Plays the cue matching `san` (see classifyMoveSound), or nothing if sound is off. */
  const playMoveSound = useCallback(
    (san: string) => {
      if (!soundEnabled) return
      getSoundPlayer().play(classifyMoveSound(san))
    },
    [soundEnabled],
  )

  return { soundEnabled, setSoundEnabled, toggleSound, playMoveSound }
}
