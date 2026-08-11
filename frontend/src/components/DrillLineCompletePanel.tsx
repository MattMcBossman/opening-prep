import { useMemo } from 'react'
import type { Ref } from 'react'
import { formatMoveListFromPly, uciLineToSan } from '../lib/chessUtils'
import { formatScore } from '../lib/formatScore'
import { describeCommonContinuations, describePositionEvaluation } from '../lib/drillPositionAssessment'
import type { EngineEvaluation, ExplorerResponse } from '../types'
import { ENGINE_DISPLAY_NAME } from '../lib/engineEvaluationCache'

type Props = {
  evaluation: EngineEvaluation | null
  explorerData: ExplorerResponse | null
  playerFollowupData: ExplorerResponse | null
  playerFollowupAfterSans: string[]
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
  onViewInExplorer: () => void
  primaryActionRef?: Ref<HTMLButtonElement>
}

/**
 * Shown once a drill line is completed, pausing the session at the final
 * position until the user acknowledges it - see the Phase 3 plan's "pause
 * after each completed drill" addendum. The opponent's best untried response
 * (an arrow on the board, drawn by the caller from the same `evaluation`) is
 * summarized here as text, since the user hasn't prepped a reply to it yet,
 * alongside the engine's verdict on the position the line ends in. The
 * real-world stats for that same position are rendered separately by the caller
 * (see DrillView), next to this panel.
 */
export function DrillLineCompletePanel({ evaluation, explorerData, playerFollowupData, playerFollowupAfterSans, leafPly, isLastDrill, onNext, onViewInExplorer, primaryActionRef }: Props) {
  const pvText = useMemo(() => {
    if (!evaluation) return ''
    const sanMoves = uciLineToSan(evaluation.fen, evaluation.pvUci)
    return formatMoveListFromPly(leafPly, sanMoves)
  }, [evaluation, leafPly])
  const commonMovesText = useMemo(() => describeCommonContinuations(explorerData), [explorerData])
  const playerMovesText = useMemo(() => describeCommonContinuations(playerFollowupData), [playerFollowupData])

  return (
    <div className="panel drill-line-complete">
      <h3>Line complete!</h3>
      {evaluation ? (
        <>
          <p className="drill-line-complete-eval">
            Engine: <strong>{formatScore(evaluation)}</strong>{' '}
            <span className="score-label">({ENGINE_DISPLAY_NAME} · depth {evaluation.depth})</span>
          </p>
          <p className="panel-status">{describePositionEvaluation(evaluation)}</p>
          <p className="panel-status">The orange arrow is Stockfish&apos;s recommended continuation.</p>
          {pvText && <p className="engine-line" title={pvText}>{pvText}</p>}
          {commonMovesText && (
            <p className="panel-status">
              {commonMovesText} Blue arrows show frequent alternatives; they are game statistics, not engine recommendations.
            </p>
          )}
          {playerMovesText && playerFollowupAfterSans.length > 0 && (
            <p className="panel-status">
              Across the common replies {playerFollowupAfterSans.join(', ')}, {playerMovesText.toLowerCase()} Green arrows show the player side&apos;s common next moves.
            </p>
          )}
        </>
      ) : (
        <p className="panel-status">Checking {ENGINE_DISPLAY_NAME}&apos;s best try for the opponent…</p>
      )}
      <div className="board-controls">
        <button type="button" onClick={onViewInExplorer}>
          View in explorer
        </button>
        <button ref={primaryActionRef} type="button" onClick={onNext}>
          {isLastDrill ? 'Finish' : 'Next drill'}
        </button>
      </div>
    </div>
  )
}
