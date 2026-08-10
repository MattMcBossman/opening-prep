import { describe, expect, it } from 'vitest'
import { commonContinuations, describeCommonContinuations, describePositionEvaluation } from './drillPositionAssessment'
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

  it('summarizes the leading empirical moves', () => {
    expect(describeCommonContinuations(explorer)).toBe('Most common in the Lichess sample: Nf6 50%, Nc6 40%, d6 5%.')
  })
})
