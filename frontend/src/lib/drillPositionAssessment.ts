import type { EngineEvaluation, ExplorerMoveStat, ExplorerResponse, RepertoireColor } from '../types'
import { canonicalMoveUci } from './chessUtils'

export type CommonContinuation = ExplorerMoveStat & { percentage: number }

type FollowupBranch = {
  immediateGames: number
  stats: ExplorerResponse
}

/** The empirical main continuation, including its share of the position sample. */
export function mostCommonContinuation(explorer: ExplorerResponse | null): CommonContinuation | null {
  if (!explorer || explorer.totalGames <= 0 || explorer.moves.length === 0) return null
  const move = explorer.moves.reduce((best, candidate) => candidate.totalGames > best.totalGames ? candidate : best)
  return { ...move, percentage: (move.totalGames / explorer.totalGames) * 100 }
}

/** Normalize the alternate king-to-rook UCI castling encoding for display. */
export function canonicalArrowUci(uci: string): string {
  return canonicalMoveUci(uci)
}

/**
 * Turns Stockfish's numeric score into a deliberately modest, position-specific
 * verdict. This describes the evaluation only; it does not pretend that a
 * single principal variation explains strategic plans in the position.
 */
export function describePositionEvaluation(evaluation: EngineEvaluation): string {
  if (evaluation.terminal) {
    if (evaluation.scoreType === 'mate' && evaluation.scoreValue !== 0) {
      return `${evaluation.scoreValue > 0 ? 'White' : 'Black'} has checkmated.`
    }
    return 'The game is over in this position.'
  }

  if (evaluation.scoreType === 'mate') {
    if (evaluation.scoreValue === 0) return 'Stockfish sees no forced win.'
    return `Stockfish finds a forced mate for ${evaluation.scoreValue > 0 ? 'White' : 'Black'}.`
  }

  const magnitude = Math.abs(evaluation.scoreValue)
  if (magnitude < 20) return 'Stockfish assesses the position as roughly equal.'

  const side = evaluation.scoreValue > 0 ? 'White' : 'Black'
  if (magnitude < 80) return `Stockfish gives ${side} a slight edge.`
  if (magnitude < 180) return `Stockfish gives ${side} a clear advantage.`
  return `Stockfish sees ${side} as winning.`
}

/** Most frequent empirical continuations, suitable for secondary board arrows. */
export function commonContinuations(
  explorer: ExplorerResponse | null,
  engineBestMove: string | null,
  limit = 3,
): CommonContinuation[] {
  if (!explorer || explorer.totalGames <= 0) return []
  const canonicalEngineMove = engineBestMove ? canonicalArrowUci(engineBestMove) : null
  const seen = new Set<string>()
  return explorer.moves
    .map((move) => ({ ...move, percentage: (move.totalGames / explorer.totalGames) * 100 }))
    .sort((a, b) => b.totalGames - a.totalGames)
    .filter((move) => {
      const canonical = canonicalArrowUci(move.uci)
      if (canonical === canonicalEngineMove || seen.has(canonical) || move.percentage < 5) return false
      seen.add(canonical)
      return true
    })
    .slice(0, limit)
}

/**
 * Seam-free color scale for react-chessboard arrows. The library renders the
 * shaft and head as overlapping SVG shapes, so translucent colors create a
 * dark patch at their join. Keep arrows fully opaque and encode frequency by
 * blue lightness instead: common moves are darker, rarer moves lighter.
 */
export function continuationArrowColor(percentage: number): string {
  const bounded = Math.max(0, Math.min(100, percentage))
  const lightness = Math.round(70 - bounded * 0.28)
  return `hsl(218 78% ${lightness}%)`
}

/** Green scale reserved for the player's conditional next-ply continuations. */
export function playerContinuationArrowColor(percentage: number): string {
  const bounded = Math.max(0, Math.min(100, percentage))
  const lightness = Math.round(68 - bounded * 0.24)
  return `hsl(145 55% ${lightness}%)`
}

/**
 * Combines player replies from several possible opponent continuations. Each
 * reply is weighted by both the branch's frequency and its conditional share;
 * identical UCI replies across branches become one arrow.
 */
export function combinePlayerFollowups(branches: FollowupBranch[]): ExplorerResponse | null {
  if (branches.length === 0) return null
  const combined = new Map<string, ExplorerMoveStat>()
  let totalGames = 0
  for (const branch of branches) {
    if (branch.stats.totalGames <= 0) continue
    totalGames += branch.immediateGames
    for (const move of branch.stats.moves) {
      const weight = branch.immediateGames / branch.stats.totalGames
      const weightedGames = move.totalGames * weight
      const existing = combined.get(canonicalArrowUci(move.uci))
      const next = existing ?? { ...move, uci: canonicalArrowUci(move.uci), white: 0, draws: 0, black: 0, totalGames: 0 }
      next.white += move.white * weight
      next.draws += move.draws * weight
      next.black += move.black * weight
      next.totalGames += weightedGames
      combined.set(next.uci, next)
    }
  }
  if (totalGames <= 0) return null
  return { totalGames, moves: [...combined.values()], opening: null }
}

export type PracticalMoveOutcome = {
  side: 'White' | 'Black'
  games: number
  losses: number
  lossPercentage: number
  positionLossPercentage: number
}

export const MIN_POSITION_SAMPLE_GAMES = 200
export const MIN_MOVE_SAMPLE_GAMES = 30

/** Empirical result of the attempted move, explicitly separate from engine causality. */
export function practicalMoveOutcome(
  explorer: ExplorerResponse | null,
  uci: string,
  mover: RepertoireColor,
): PracticalMoveOutcome | null {
  const move = explorer?.moves.find((candidate) => candidate.uci === uci)
  const positionGames = explorer?.totalGames ?? 0
  if (!explorer || !move || positionGames < MIN_POSITION_SAMPLE_GAMES || move.totalGames < MIN_MOVE_SAMPLE_GAMES) return null
  const losses = mover === 'white' ? move.black : move.white
  const returnedMoveGames = explorer.moves.reduce((sum, candidate) => sum + candidate.totalGames, 0)
  const allLosses = explorer.moves.reduce(
    (sum, candidate) => sum + (mover === 'white' ? candidate.black : candidate.white),
    0,
  )
  return {
    side: mover === 'white' ? 'White' : 'Black',
    games: move.totalGames,
    losses,
    lossPercentage: Math.round((losses / move.totalGames) * 100),
    positionLossPercentage: returnedMoveGames > 0 ? Math.round((allLosses / returnedMoveGames) * 100) : 0,
  }
}

export function describeCommonContinuations(explorer: ExplorerResponse | null): string | null {
  if (!explorer || explorer.totalGames <= 0 || explorer.moves.length === 0) return null
  const moves = explorer.moves
    .slice()
    .sort((a, b) => b.totalGames - a.totalGames)
    .slice(0, 3)
    .map((move) => `${move.san} ${Math.round((move.totalGames / explorer.totalGames) * 100)}%`)
  return `Most common in the Lichess sample: ${moves.join(', ')}.`
}
