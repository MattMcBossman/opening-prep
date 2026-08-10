import { describe, expect, it } from 'vitest'
import { canonicalArrowUci, combinePlayerFollowups, commonContinuations, continuationArrowColor, describeCommonContinuations, describePositionEvaluation, mostCommonContinuation, playerContinuationArrowColor, practicalMoveOutcome } from './drillPositionAssessment'
import type { EngineEvaluation, ExplorerResponse } from '../types'

function evaluation(scoreValue: number, scoreType: 'cp' | 'mate' = 'cp'): EngineEvaluation {
  return { fen: 'fen', depth: 14, scoreType, scoreValue, bestMoveUci: 'g8f6', pvUci: [], thinking: false }
}

describe('describePositionEvaluation', () => {
  it('uses calibrated language for centipawn evaluations', () => {
    expect(describePositionEvaluation(evaluation(10))).toContain('roughly equal')
    expect(describePositionEvaluation(evaluation(-45))).toBe('Stockfish gives Black a slight edge.')
    expect(describePositionEvaluation(evaluation(120))).toBe('Stockfish gives White a clear advantage.')
    expect(describePositionEvaluation(evaluation(-250))).toBe('Stockfish sees Black as winning.')
  })

  it('describes forced mate without converting it to a material advantage', () => {
    expect(describePositionEvaluation(evaluation(4, 'mate'))).toBe('Stockfish finds a forced mate for White.')
  })
})

const explorer: ExplorerResponse = {
  totalGames: 100,
  opening: null,
  moves: [
    { san: 'Nf6', uci: 'g8f6', white: 10, draws: 10, black: 30, totalGames: 50 },
    { san: 'Nc6', uci: 'b8c6', white: 8, draws: 8, black: 24, totalGames: 40 },
    { san: 'd6', uci: 'd7d6', white: 2, draws: 2, black: 1, totalGames: 5 },
    { san: 'a6', uci: 'a7a6', white: 2, draws: 1, black: 2, totalGames: 5 },
  ],
}

describe('commonContinuations', () => {
  it('excludes the engine arrow and retains statistically meaningful alternatives', () => {
    expect(commonContinuations(explorer, 'g8f6').map((move) => move.uci)).toEqual(['b8c6', 'd7d6', 'a7a6'])
  })

  it('canonicalizes and deduplicates alternate castling encodings', () => {
    expect(canonicalArrowUci('e1h1')).toBe('e1g1')
    const castlingExplorer: ExplorerResponse = {
      totalGames: 100,
      opening: null,
      moves: [
        { san: 'O-O', uci: 'e1h1', white: 25, draws: 10, black: 15, totalGames: 50 },
        { san: 'O-O', uci: 'e1g1', white: 20, draws: 10, black: 10, totalGames: 40 },
      ],
    }
    expect(commonContinuations(castlingExplorer, 'e1g1')).toEqual([])
  })

  it('summarizes the leading empirical moves', () => {
    expect(describeCommonContinuations(explorer)).toBe('Most common in the Lichess sample: Nf6 50%, Nc6 40%, d6 5%.')
  })

  it('identifies the move used to condition player follow-up arrows', () => {
    expect(mostCommonContinuation(explorer)?.uci).toBe('g8f6')
    expect(mostCommonContinuation(explorer)?.percentage).toBe(50)
  })
})

describe('continuationArrowColor', () => {
  it('uses opaque colors and makes more frequent moves visually stronger', () => {
    expect(continuationArrowColor(10)).toBe('hsl(218 78% 67%)')
    expect(continuationArrowColor(80)).toBe('hsl(218 78% 48%)')
    expect(continuationArrowColor(80)).not.toContain('rgba')
    expect(playerContinuationArrowColor(80)).toBe('hsl(145 55% 49%)')
    expect(playerContinuationArrowColor(80)).not.toContain('rgba')
  })
})

describe('combinePlayerFollowups', () => {
  it('weights replies across branches and deduplicates the same move', () => {
    const combined = combinePlayerFollowups([
      { immediateGames: 60, stats: { ...explorer, totalGames: 100 } },
      { immediateGames: 40, stats: { ...explorer, totalGames: 200 } },
    ])
    expect(combined?.totalGames).toBe(100)
    expect(combined?.moves.find((move) => move.uci === 'g8f6')?.totalGames).toBe(40)
  })
})

describe('practicalMoveOutcome', () => {
  const largeSample: ExplorerResponse = {
    ...explorer,
    totalGames: 300,
    moves: explorer.moves.map((move) => ({
      ...move,
      white: move.white * 3,
      draws: move.draws * 3,
      black: move.black * 3,
      totalGames: move.totalGames * 3,
    })),
  }

  it('reports side-aware losses and the position baseline', () => {
    expect(practicalMoveOutcome(largeSample, 'g8f6', 'black')).toEqual({
      side: 'Black', games: 150, losses: 30, lossPercentage: 20, positionLossPercentage: 22,
    })
    expect(practicalMoveOutcome(largeSample, 'g8f6', 'white')?.lossPercentage).toBe(60)
  })

  it('suppresses claims when the position or attempted move sample is too small', () => {
    expect(practicalMoveOutcome(explorer, 'g8f6', 'black')).toBeNull()
    expect(practicalMoveOutcome(largeSample, 'a7a6', 'black')).toBeNull()
  })
})
