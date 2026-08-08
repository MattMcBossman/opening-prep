import { useMemo } from 'react'
import { uciLineToSan } from '../lib/chessUtils'
import type { EngineEvaluation } from '../types'

type Props = {
  evaluation: EngineEvaluation | null
}

function formatScore(evaluation: EngineEvaluation): string {
  if (evaluation.scoreType === 'mate') {
    return evaluation.scoreValue === 0 ? '0.0' : `#${Math.abs(evaluation.scoreValue)}`
  }
  const pawns = evaluation.scoreValue / 100
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`
}

export function EngineEvalPanel({ evaluation }: Props) {
  const pvSan = useMemo(
    () => (evaluation ? uciLineToSan(evaluation.fen, evaluation.pvUci) : []),
    [evaluation],
  )

  if (!evaluation) {
    return <p className="panel-status">Starting engine…</p>
  }

  return (
    <div className="engine-panel">
      <div className="engine-score">
        <span className="score-value">{formatScore(evaluation)}</span>
        <span className="score-label">
          {evaluation.thinking ? `depth ${evaluation.depth}/20` : `depth 20 (done)`}
        </span>
      </div>
      {pvSan.length > 0 && <p className="engine-line">{pvSan.join(' ')}</p>}
    </div>
  )
}
