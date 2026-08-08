import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { collectDrillLines } from '../lib/repertoireDrills'
import type { DrillStep } from '../lib/repertoireDrills'
import {
  acknowledgeLineCompletion,
  applyMoveClassification,
  attemptOwnMove as attemptOwnMoveLogic,
  createDrillSession,
  isSessionComplete,
  retryFailedLines as retryFailedLinesLogic,
  sessionProgress,
  wouldAcceptOwnMove,
} from '../lib/drillSessionLogic'
import type { DrillSessionState } from '../lib/drillSessionLogic'
import { useEngineComparison } from './useEngineComparison'
import { findNearestSimilarPosition } from '../lib/positionSimilarity'
import type { SimilarPositionMatch } from '../lib/positionSimilarity'
import { START_FEN } from './useGame'
import type { EngineEvaluation, RepertoireColor, RepertoireMove } from '../types'

type UseDrillSessionParams = {
  color: RepertoireColor
  getContinuations: (fen: string) => RepertoireMove[]
  rootFen?: string
}

// How close (by Hamming distance) two positions need to be before surfacing one as
// a "similar position" hint - conservative, since a large distance stops being a
// meaningful transposition signal (see the Phase 3 plan's similar-position section).
const SIMILARITY_MAX_DISTANCE = 6

export type SimilarPositionHint = SimilarPositionMatch & {
  /** Whether the move the user just played is itself saved from the similar position. */
  matchesPlayedMove: boolean
}

/**
 * Drives a drill session: enumerates leaf-path drill lines from the repertoire,
 * owns the pure session state machine (see drillSessionLogic.ts), and layers on
 * the async bits that don't belong in pure logic - engine-based wrong-move
 * classification and similar-position hinting. Kept fully separate from
 * explorer/useGame state so practicing can never mutate the repertoire (see the
 * Phase 3 plan's "Risks and decisions").
 */
export function useDrillSession({ color, getContinuations, rootFen = START_FEN }: UseDrillSessionParams) {
  const { compare, evaluatePosition } = useEngineComparison()
  const [state, setState] = useState<DrillSessionState>(() =>
    createDrillSession(collectDrillLines(color, getContinuations, rootFen), rootFen),
  )
  // The opponent's best untried response from the position where the just-completed
  // line ends - shown as an arrow/PV during the completion pause. Fetched
  // whenever `state.completionPause` (newly) appears, cleared once it's gone.
  const [completionEval, setCompletionEval] = useState<EngineEvaluation | null>(null)

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
    const pause = state.completionPause
    if (!pause) {
      setCompletionEval(null)
      return
    }
    let cancelled = false
    setCompletionEval(null)
    evaluatePosition(pause.leafFen).then((evaluation) => {
      if (!cancelled) setCompletionEval(evaluation)
    })
    return () => {
      cancelled = true
    }
  }, [state.completionPause, evaluatePosition])

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
   * Applies one attempt and returns the steps it actually put on the board (the
   * accepted move plus any auto-played opponent reply) plus whether it completed
   * a line, so the caller can react to them imperatively - notably to sound each
   * move plus a distinct completion chime. `steps` is empty when the attempt was
   * rejected and the position didn't change.
   */
  const attemptMove = useCallback(
    (played: { uci: string; san: string; resultingFen: string }): { steps: DrillStep[]; completedLine: boolean } => {
      const prev = stateRef.current
      const next = attemptOwnMoveLogic(prev, getContinuations, played)
      if (next.lastFeedback?.kind === 'wrong') {
        const token = next.lastFeedback.attemptToken
        compare(prev.currentFen, played.resultingFen, color).then((result) => {
          setState((current) => applyMoveClassification(current, token, result))
        })
      }
      setState(next)
      return { steps: next.lastAppliedSteps, completedLine: next.completionPause !== null }
    },
    [getContinuations, compare, color],
  )

  const acknowledgeCompletion = useCallback(() => {
    setState((prev) => acknowledgeLineCompletion(prev))
  }, [])

  // Synchronous preview for the board layer to decide, at drop time, whether a
  // piece drop will actually change the position (should "stick") or not
  // (should snap back) - covers both a genuine mistake and the new "saved but
  // already fully drilled" rejection, which also never changes the position.
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
    completionEval,
    acknowledgeCompletion,
  }
}
