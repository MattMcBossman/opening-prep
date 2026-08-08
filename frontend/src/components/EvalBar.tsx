import { formatScore } from '../lib/formatScore'
import type { EngineEvaluation } from '../types'

type Props = {
  evaluation: EngineEvaluation | null
}

const SQUARES_PER_SIDE = 8
// "Roughly 2/3 of a square per +1.00 pawn" of advantage, expressed as a fraction of the
// bar's total height (one square = 1/8 of the board/bar height).
const FRACTION_PER_PAWN = 2 / 3 / SQUARES_PER_SIDE
// Short of an actual forced mate, the losing side keeps at least this sliver of the bar
// (roughly a third of a square) rather than being squeezed out entirely — a huge but
// non-mate advantage still isn't literally "100% won".
const MIN_LOSING_FRACTION = 1 / 3 / SQUARES_PER_SIDE

/** Fraction (0-1) of the bar height that should be filled white, given the current evaluation. */
function whiteFractionFor(evaluation: EngineEvaluation | null): number {
  if (!evaluation) return 0.5
  if (evaluation.scoreType === 'mate') {
    // An actual forced mate can fully saturate the bar — no reserved sliver here.
    if (evaluation.scoreValue > 0) return 1
    if (evaluation.scoreValue < 0) return 0
    return 0.5
  }
  const pawns = evaluation.scoreValue / 100
  const raw = 0.5 + pawns * FRACTION_PER_PAWN
  return Math.min(1 - MIN_LOSING_FRACTION, Math.max(MIN_LOSING_FRACTION, raw))
}

/**
 * Chess.com/Lichess-style vertical eval bar: white fills from the bottom, black from the
 * top, split proportionally to the evaluation. The +/- score sits just inside whichever
 * side is currently ahead, near the boundary between the two colors.
 */
export function EvalBar({ evaluation }: Props) {
  const whiteFraction = whiteFractionFor(evaluation)
  const whiteLeading = !evaluation || evaluation.scoreValue >= 0
  const label = evaluation ? formatScore(evaluation) : ''

  return (
    <div className="eval-bar" title={label ? `Evaluation: ${label}` : 'Starting engine…'}>
      <div className="eval-bar-black" style={{ height: `${(1 - whiteFraction) * 100}%` }}>
        {!whiteLeading && <span className="eval-bar-label eval-bar-label-on-dark">{label}</span>}
      </div>
      <div className="eval-bar-white" style={{ height: `${whiteFraction * 100}%` }}>
        {whiteLeading && <span className="eval-bar-label eval-bar-label-on-light">{label}</span>}
      </div>
    </div>
  )
}
