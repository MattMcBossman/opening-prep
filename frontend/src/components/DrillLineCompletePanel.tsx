import { useMemo } from 'react'
import { formatMoveListFromPly, uciLineToSan } from '../lib/chessUtils'
import type { EngineEvaluation } from '../types'

type Props = {
  evaluation: EngineEvaluation | null
  /**
   * How many plies into the game the completed line's leaf position is - needed
   * to number the continuation correctly, since `evaluation.fen` is frequently a
   * normalized FEN with no reliable move-number fields of its own (see
   * `DrillFeedback.originPly` in drillSessionLogic.ts for the same issue).
   */
  leafPly: number
  /** Whether this was the last pending line - changes the button's label. */
  isLastDrill: boolean
  onNext: () => void
}

/**
 * Shown once a drill line is completed, pausing the session at the final
 * position until the user acknowledges it - see the Phase 3 plan's "pause
 * after each completed drill" addendum. The opponent's best untried response
 * (an arrow on the board, drawn by the caller from the same `evaluation`) is
 * summarized here as text, since the user hasn't prepped a reply to it yet.
 */
export function DrillLineCompletePanel({ evaluation, leafPly, isLastDrill, onNext }: Props) {
  const pvText = useMemo(() => {
    if (!evaluation) return ''
    const sanMoves = uciLineToSan(evaluation.fen, evaluation.pvUci)
    return formatMoveListFromPly(leafPly, sanMoves)
  }, [evaluation, leafPly])

  return (
    <div className="panel drill-line-complete">
      <h3>Line complete!</h3>
      {evaluation ? (
        <>
          <p className="panel-status">
            You haven&apos;t prepped a reply here yet - the engine&apos;s best try for the opponent is shown with an
            arrow on the board.
          </p>
          {pvText && <p className="engine-line">{pvText}</p>}
        </>
      ) : (
        <p className="panel-status">Checking the engine&apos;s best try for the opponent…</p>
      )}
      <div className="board-controls">
        <button type="button" onClick={onNext}>
          {isLastDrill ? 'Finish' : 'Next drill'}
        </button>
      </div>
    </div>
  )
}
