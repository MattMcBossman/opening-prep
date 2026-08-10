import { describe, expect, it } from 'vitest'
import { aggregatePositionCoverage, calculatePositionCoverage, opponentPositions } from './repertoireCoverage'

describe('calculatePositionCoverage', () => {
  it('weights prepared opponent replies by observed game frequency', () => {
    const stats = [
      { san: 'e5', uci: 'e7e5', white: 50, draws: 10, black: 40, totalGames: 100 },
      { san: 'c5', uci: 'c7c5', white: 30, draws: 10, black: 60, totalGames: 100 },
    ]
    const saved = [
      { san: 'e5', uci: 'e7e5', resultingFen: 'after-e5' },
      { san: 'c5', uci: 'c7c5', resultingFen: 'after-c5' },
    ]
    const coverage = calculatePositionCoverage(stats, saved, (fen) =>
      fen === 'after-e5' ? [{ san: 'Nf3', uci: 'g1f3', resultingFen: 'after-nf3' }] : [],
    )
    expect(coverage).toEqual({ coveredGames: 100, totalGames: 200, percent: 50, coveredMoves: 1, totalMoves: 2 })
  })
})

describe('coverage dashboard helpers', () => {
  it('finds every position where the opponent can reply, including Black repertoire root', () => {
    const tree = {
      'root w - -': [{ san: 'e4', uci: 'e2e4', resultingFen: 'after-e4 b - -' }],
      'after-e4 b - -': [{ san: 'e5', uci: 'e7e5', resultingFen: 'after-e5 w - -' }],
    }
    expect(opponentPositions(tree, 'white')).toEqual(['after-e4 b - -'])
    expect(opponentPositions(tree, 'black')).toContain('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -')
  })

  it('averages frequency-weighted scores across repertoire positions', () => {
    expect(aggregatePositionCoverage([
      { percent: 50, coveredGames: 50, totalGames: 100, coveredMoves: 1, totalMoves: 2 },
      { percent: 100, coveredGames: 20, totalGames: 20, coveredMoves: 1, totalMoves: 1 },
    ])).toMatchObject({ percent: 75, coveredPositions: 1, totalPositions: 2 })
  })
})
