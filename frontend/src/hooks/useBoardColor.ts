import { useCallback, useState } from 'react'

const STORAGE_KEY = 'opening-prep:board-color'

export type BoardColor = 'white' | 'black'

function getInitialBoardColor(): BoardColor {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'white' || stored === 'black') return stored
  } catch {
    // localStorage may be unavailable (e.g. private browsing); fall back to white.
  }
  return 'white'
}

/**
 * Which side of the board the user is currently viewing from.
 *
 * This drives the visual board/eval-bar orientation today. It is also the intended
 * single source of truth for "which color am I working with" once Phase 2's
 * repertoire builder lands: the same value should select the White vs. Black
 * repertoire tree, and later which color's games to load from user history.
 */
export function useBoardColor() {
  const [boardColor, setBoardColorState] = useState<BoardColor>(getInitialBoardColor)

  const setBoardColor = useCallback((next: BoardColor) => {
    setBoardColorState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Best-effort persistence only.
    }
  }, [])

  const toggleBoardColor = useCallback(() => {
    setBoardColor(boardColor === 'white' ? 'black' : 'white')
  }, [boardColor, setBoardColor])

  return { boardColor, setBoardColor, toggleBoardColor }
}
