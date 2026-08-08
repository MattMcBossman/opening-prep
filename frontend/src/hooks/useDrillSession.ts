import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { collectDrillLines } from '../lib/repertoireDrills'
import type { DrillStep } from '../lib/repertoireDrills'
import {
  acknowledgeLineCompletion,
  advanceAutoPlay,
  applyMoveClassification,
  attemptOwnMove as attemptOwnMoveLogic,
  createDrillSession,
  isSessionComplete,
  pendingAutoPlayStep,
  retryFailedLines as retryFailedLinesLogic,
  sessionProgress,
  wouldAcceptOwnMove,
} from '../lib/drillSessionLogic'
import type { DrillSessionState } from '../lib/drillSessionLogic'
import { useEngineComparison } from './useEngineComparison'
import { denormalizeFen } from '../lib/chessUtils'
import { findNearestSimilarPosition } from '../lib/positionSimilarity'
import type { SimilarPositionMatch } from '../lib/positionSimilarity'
import { START_FEN } from './useGame'
import type { EngineEvaluation, RepertoireColor, RepertoireMove } from '../types'

type UseDrillSessionParams = {
  color: RepertoireColor
  getContinuations: (fen: string) => RepertoireMove[]
  rootFen?: string
  /** Called for every ply actually applied to the board, in the order it happens. */
  onStepApplied?: (step: DrillStep) => void
  /** Called once a line is completed (right as the review pause begins). */
  onLineComplete?: () => void
}

// How close (by Hamming distance) two positions need to be before surfacing one as
// a "similar position" hint - conservative, since a large distance stops being a
// meaningful transposition signal (see the Phase 3 plan's similar-position section).
const SIMILARITY_MAX_DISTANCE = 6

// react-chessboard's own move animation defaults to 300ms (see its
// `animationDurationInMs`); auto-playing the opponent's reply this long after the
// user's own move lets that first slide finish before the second one starts,
// rather than jumping both plies in one board update - see `advanceAutoPlay`.
const AUTO_PLAY_DELAY_MS = 320

export type SimilarPositionHint = SimilarPositionMatch & {
  /** Whether the move the user just played is itself saved from the similar position. */
  matchesPlayedMove: boolean
}

/**
 * Drives a drill session: enumerates leaf-path drill lines from the repertoire,
 * owns the pure session state machine (see drillSessionLogic.ts), and layers on
 * the async bits that don't belong in pure logic - engine-based wrong-move
 * classification, similar-position hinting, and timing the opponent's
 * auto-played reply so it animates as its own move instead of jumping straight
 * to the post-reply position. Kept fully separate from explorer/useGame state
 * so practicing can never mutate the repertoire (see the Phase 3 plan's "Risks
 * and decisions").
 */
export function useDrillSession({
  color,
  getContinuations,
  rootFen = START_FEN,
  onStepApplied,
  onLineComplete,
}: UseDrillSessionParams) {
  const { compare, evaluatePosition } = useEngineComparison()
  const [state, setState] = useState<DrillSessionState>(() =>
    createDrillSession(collectDrillLines(color, getContinuations, rootFen), rootFen),
  )
  // The opponent's best untried response from the position where the just-completed
  // line ends - shown as an arrow/PV during the completion pause. Fetched
  // whenever `state.completionPause` (newly) appears, cleared once it's gone.
  const [completionEval, setCompletionEval] = useState<EngineEvaluation | null>(null)

  // The paused-at position as a complete FEN. `completionPause.leafFen` is a
  // normalized repertoire key (see normalizeFen), which isn't a well-formed FEN
  // for consumers that parse all six fields - the engine and the Lichess
  // explorer both get this instead.
  const completionFen = useMemo(
    () => (state.completionPause ? denormalizeFen(state.completionPause.leafFen, state.completionPause.leafPly) : null),
    [state.completionPause],
  )

  // Positions where it was the drilling color's own turn, across every enumerated
  // line - the candidate pool for "is this wrong move actually saved somewhere
  // similar-looking?" (see similarPosition below). Own-turn positions only, since
  // wrong-move attempts only ever happen on the drilling color's own turn.
  const ownTurnFens = useMemo(() => {
    const fens = new Set<string>()
    for (const line of state.lines) {
      for (const step of line.steps) {
        if (step.mover === 'own') fens.add(step.fen)
      }
    }
    return fens
  }, [state.lines])

  const startNewSession = useCallback(() => {
    setState(createDrillSession(collectDrillLines(color, getContinuations, rootFen), rootFen))
  }, [color, getContinuations, rootFen])

  // Re-collect and restart whenever the drilled color or root position changes -
  // e.g. the user switches from drilling White to drilling Black. Deliberately
  // NOT reacting to `getContinuations` identity changes alone: a drill session is
  // a fixed snapshot of the repertoire for its duration (see the Phase 3 plan's
  // "Risks and decisions" - drilling must never fight with concurrent editing).
  useEffect(() => {
    setState(createDrillSession(collectDrillLines(color, getContinuations, rootFen), rootFen))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color, rootFen])

  useEffect(() => {
    if (!completionFen) {
      setCompletionEval(null)
      return
    }
    let cancelled = false
    setCompletionEval(null)
    evaluatePosition(completionFen).then((evaluation) => {
      if (!cancelled) setCompletionEval(evaluation)
    })
    return () => {
      cancelled = true
    }
  }, [completionFen, evaluatePosition])

  // Mirrors the latest committed state so attemptMove can compute its result up
  // front rather than inside a state updater. attemptMove only ever runs from a DOM
  // event handler (never during render), so the ref is never stale by then - and
  // computing outside the updater keeps the async engine comparison from being
  // kicked off twice under StrictMode, which deliberately double-invokes updaters.
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  /**
   * Whenever the current position is awaiting an opponent auto-play (see
   * `pendingAutoPlayStep`), schedules it as its own delayed step - reacting to
   * `state` itself, rather than only being kicked off right after the user's
   * own move, is what makes this also fire when an occurrence *starts* with
   * the opponent to move (every occurrence when drilling Black, since the game
   * always begins with White to move) - previously nothing ever triggered that
   * first reply, so drilling Black looked stuck until White's move was made
   * some other way. The effect's cleanup (on the next state change, or
   * unmount) cancels a timer that hasn't fired yet, so at most one is ever
   * in flight, however state got here (a session start/restart/retry, an
   * acknowledged completion, or the user's own move).
   */
  useEffect(() => {
    if (!pendingAutoPlayStep(state)) return
    const timeoutId = setTimeout(() => {
      setState((current) => {
        const next = advanceAutoPlay(current)
        if (next === current) return current
        for (const step of next.lastAppliedSteps) onStepApplied?.(step)
        if (next.completionPause) onLineComplete?.()
        return next
      })
    }, AUTO_PLAY_DELAY_MS)
    return () => clearTimeout(timeoutId)
  }, [state, onStepApplied, onLineComplete])

  /**
   * Attempts one of the drilling color's own moves. Any resulting ply is
   * reported via `onStepApplied` as it's actually applied - immediately for
   * the move itself, and again after a short delay for its auto-played
   * opponent reply (see the effect above) - rather than all at once, so the
   * caller (the board) can animate each ply individually instead of jumping
   * several plies in one update.
   */
  const attemptMove = useCallback(
    (played: { uci: string; san: string; resultingFen: string }) => {
      const prev = stateRef.current
      const next = attemptOwnMoveLogic(prev, getContinuations, played)
      if (next === prev) return
      if (next.lastFeedback?.kind === 'wrong') {
        const token = next.lastFeedback.attemptToken
        compare(prev.currentFen, played.resultingFen, color).then((result) => {
          setState((current) => applyMoveClassification(current, token, result))
        })
      }
      setState(next)
      for (const step of next.lastAppliedSteps) onStepApplied?.(step)
      if (next.completionPause) onLineComplete?.()
    },
    [getContinuations, compare, color, onStepApplied, onLineComplete],
  )

  const acknowledgeCompletion = useCallback(() => {
    setState((prev) => acknowledgeLineCompletion(prev))
  }, [])

  // Synchronous preview for the board layer to decide, at drop time, whether a
  // piece drop will actually change the position (should "stick") or not
  // (should snap back) - covers a genuine mistake, a saved-but-already-drilled
  // rejection, and the brief window where an opponent reply is queued but not
  // yet auto-played, all of which leave the position unchanged.
  const wouldAccept = useCallback((uci: string) => wouldAcceptOwnMove(state, getContinuations, uci), [state, getContinuations])

  const retryFailed = useCallback(() => setState((prev) => retryFailedLinesLogic(prev)), [])

  const similarPosition = useMemo<SimilarPositionHint | null>(() => {
    const feedback = state.lastFeedback
    if (feedback?.kind !== 'wrong') return null
    const match = findNearestSimilarPosition(feedback.originFen, ownTurnFens, SIMILARITY_MAX_DISTANCE)
    if (!match) return null
    const matchesPlayedMove = getContinuations(match.fen).some((m) => m.uci === feedback.playedUci)
    return { ...match, matchesPlayedMove }
  }, [state.lastFeedback, ownTurnFens, getContinuations])

  return {
    state,
    progress: sessionProgress(state),
    complete: isSessionComplete(state),
    attemptMove,
    wouldAccept,
    retryFailed,
    startNewSession,
    similarPosition,
    completionFen,
    completionEval,
    acknowledgeCompletion,
  }
}
