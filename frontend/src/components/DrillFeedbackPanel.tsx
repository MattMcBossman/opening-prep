import { useMemo } from 'react'
import { formatMoveListFromPly, uciLineToSan } from '../lib/chessUtils'
import { practicalMoveOutcome } from '../lib/drillPositionAssessment'
import { formatCompactNumber } from '../lib/formatNumber'
import type { DrillFeedback } from '../lib/drillSessionLogic'
import type { SimilarPositionHint } from '../hooks/useDrillSession'
import type { ExplorerResponse, RepertoireColor } from '../types'

type Props = {
  feedback: DrillFeedback | null
  similarPosition: SimilarPositionHint | null
  color: RepertoireColor
  lichessData?: ExplorerResponse | null
  lichessLoading?: boolean
}

/**
 * See the Phase 3 plan's "Wrong-move feedback" section: attempt 1 just reverts
 * the move (plus the engine's best-response line when the move is objectively
 * bad); attempts 2+ additionally reveal square hints (handled by the board via
 * `feedback.hintFrom`/`hintTo` - this panel only covers the textual side).
 */
export function DrillFeedbackPanel({ feedback, similarPosition, color, lichessData, lichessLoading = false }: Props) {
  const pvText = useMemo(() => {
    if (feedback?.kind !== 'wrong' || !feedback.bestResponseLine) return ''
    const sanMoves = uciLineToSan(feedback.bestResponseLine.fen, feedback.bestResponseLine.pvUci)
    // The best-response line starts right after the wrong move, i.e. one ply
    // past `originPly` - see the module doc on DrillFeedback.originPly for why
    // this can't be derived from `bestResponseLine.fen` itself (it's frequently
    // a normalized FEN with no reliable move-number fields of its own).
    return formatMoveListFromPly(feedback.originPly + 1, sanMoves)
  }, [feedback])

  if (!feedback || feedback.kind === 'correct') {
    return <p className="panel-status">{feedback ? 'Correct - keep going.' : 'Play the first move of the line.'}</p>
  }

  if (feedback.kind === 'alreadyDrilled') {
    return (
      <p className="panel-status">
        {feedback.playedSan} is saved here, but you&apos;ve already fully drilled that branch this session - try
        the other option instead.
      </p>
    )
  }

  const practicalOutcome = practicalMoveOutcome(lichessData ?? null, feedback.playedUci, color)

  return (
    <div className="drill-feedback">
      <p className="drill-feedback-message">
        {feedback.playedSan} isn&apos;t the prepared move here
        {feedback.attemptNumber > 1 ? ` (attempt ${feedback.attemptNumber})` : ''}.
      </p>
      {feedback.isBad === undefined && <p className="panel-status">Checking with the engine…</p>}
      {feedback.isBad === true && (
        <div className="drill-feedback-bad">
          <p>
            That&apos;s objectively bad
            {feedback.cpLoss != null ? ` (lost about ${Math.round(feedback.cpLoss)} centipawns)` : ''} - here&apos;s
            how it would be punished:
          </p>
          {pvText && <p className="engine-line">{pvText}</p>}
        </div>
      )}
      {feedback.isBad === false && <p className="panel-status">Not a bad move, just not the one you prepared.</p>}
      {lichessLoading && !lichessData && <p className="panel-status">Checking practical results on Lichess…</p>}
      {practicalOutcome && (
        <p className="drill-feedback-practical">
          In {formatCompactNumber(practicalOutcome.games)} Lichess games after this move, {practicalOutcome.side} lost{' '}
          <strong>{practicalOutcome.lossPercentage}%</strong> (compared with {practicalOutcome.positionLossPercentage}%
          across moves from this position). This is historical game data, not proof that the move caused those losses.
        </p>
      )}
      {similarPosition && (
        <p className="drill-feedback-similar">
          {similarPosition.matchesPlayedMove
            ? "This move is saved in a very similar position elsewhere in your prep - could be a transposition."
            : `There's a similar position in your prep (${similarPosition.differingSquares.length} square${similarPosition.differingSquares.length === 1 ? '' : 's'} differ).`}
        </p>
      )}
    </div>
  )
}
