import type { RepertoireColor } from '../types'

export type SimpleEval = {
  scoreType: 'cp' | 'mate'
  /** Always from White's perspective - see EngineEvaluation. */
  scoreValue: number
}

/**
 * Mate scores aren't directly comparable to centipawns, but for classification
 * purposes we only care that a mate swing is clearly decisive - collapse it to a
 * constant far outside any realistic cp-loss threshold, signed the same way
 * EngineEvaluation signs cp scores (positive favors White).
 */
const MATE_SCORE_MAGNITUDE = 100_000

function toCpEquivalent(evaluation: SimpleEval): number {
  if (evaluation.scoreType === 'cp') return evaluation.scoreValue
  if (evaluation.scoreValue === 0) return 0
  return Math.sign(evaluation.scoreValue) * MATE_SCORE_MAGNITUDE
}

/** See the Phase 3 plan's "Wrong-move feedback" section. */
export const BAD_MOVE_CP_THRESHOLD = 50

export type MoveQuality = {
  /** How many centipawns worse the position became for `mover`, from their perspective. */
  cpLoss: number
  /** True once `cpLoss` reaches `threshold` - the wrong move is objectively bad, not just off-book. */
  isBad: boolean
}

/**
 * Classifies a played move by comparing the engine eval just before it was played
 * (the best achievable result for `mover`) against the eval of the resulting
 * position (now reflecting the actual consequence of the move). Both evals are
 * always reported from White's perspective (see EngineEvaluation), so the sign is
 * flipped when `mover` is Black before taking the difference.
 */
export function classifyMoveQuality(
  before: SimpleEval,
  after: SimpleEval,
  mover: RepertoireColor,
  threshold: number = BAD_MOVE_CP_THRESHOLD,
): MoveQuality {
  const beforeCp = toCpEquivalent(before)
  const afterCp = toCpEquivalent(after)
  const cpLoss = mover === 'white' ? beforeCp - afterCp : afterCp - beforeCp
  return { cpLoss, isBad: cpLoss >= threshold }
}
