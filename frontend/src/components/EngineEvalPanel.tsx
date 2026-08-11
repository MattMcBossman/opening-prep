import { useMemo } from 'react'
import { formatMoveList, uciLineToSan } from '../lib/chessUtils'
import type { EngineEvaluation } from '../types'
import { ENGINE_DISPLAY_NAME } from '../lib/engineEvaluationCache'

type Props = {
  evaluation: EngineEvaluation | null
}

// The +/- score itself is shown on the eval bar next to the board; this panel just
// covers the supporting detail (search depth and best line) that doesn't fit there.
export function EngineEvalPanel({ evaluation }: Props) {
  const pvText = useMemo(() => {
    if (!evaluation) return ''
    const sanMoves = uciLineToSan(evaluation.fen, evaluation.pvUci)
    return formatMoveList(evaluation.fen, sanMoves)
  }, [evaluation])

  if (!evaluation) {
    return <p className="panel-status">Starting {ENGINE_DISPLAY_NAME}…</p>
  }

  return (
    <div className="engine-panel">
      <span className="score-label">
        {ENGINE_DISPLAY_NAME} · {evaluation.thinking ? `depth ${evaluation.depth}/20` : `depth ${evaluation.depth} (done)`}
      </span>
      {pvText && <p className="engine-line" title={pvText}>{pvText}</p>}
    </div>
  )
}
