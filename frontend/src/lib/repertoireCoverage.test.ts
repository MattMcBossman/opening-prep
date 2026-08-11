import { describe, expect, it } from 'vitest'
import { aggregatePositionCoverage, calculatePositionCoverage, coverageGapImpact, opponentPositions, rankCoverageGaps } from './repertoireCoverage'

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

  it('weights the profile aggregate by each position sample size', () => {
    expect(aggregatePositionCoverage([
      { percent: 50, coveredGames: 50, totalGames: 100, coveredMoves: 1, totalMoves: 2 },
      { percent: 100, coveredGames: 20, totalGames: 20, coveredMoves: 1, totalMoves: 1 },
    ])).toMatchObject({
      percent: 58.333333333333336,
      coveredPositions: 1,
      partiallyCoveredPositions: 1,
      noDataPositions: 0,
      totalPositions: 2,
    })
  })

  it('uses the 95% practical target and reports no-data positions separately', () => {
    expect(aggregatePositionCoverage([
      { percent: 95, coveredGames: 95, totalGames: 100, coveredMoves: 2, totalMoves: 3 },
      { percent: 94.9, coveredGames: 949, totalGames: 1000, coveredMoves: 2, totalMoves: 3 },
      { percent: 0, coveredGames: 0, totalGames: 0, coveredMoves: 0, totalMoves: 0 },
    ])).toMatchObject({
      coveredPositions: 1,
      partiallyCoveredPositions: 1,
      noDataPositions: 1,
      totalPositions: 3,
    })
  })

  it('ranks equal gaps by their absolute number of uncovered games', () => {
    const lowPercentageButSmallSample = { fen: 'small', percent: 0, coveredGames: 0, totalGames: 100, coveredMoves: 0, totalMoves: 1 }
    const highImpact = { fen: 'large', percent: 90, coveredGames: 9000, totalGames: 10000, coveredMoves: 1, totalMoves: 2 }
    const complete = { fen: 'complete', percent: 100, coveredGames: 50000, totalGames: 50000, coveredMoves: 1, totalMoves: 1 }

    expect(rankCoverageGaps([lowPercentageButSmallSample, highImpact, complete], 'white').map((position) => position.fen))
      .toEqual(['large', 'small'])
  })

  it('discounts a winning position below a smaller equal position', () => {
    const winning = {
      fen: 'winning', percent: 0, coveredGames: 0, totalGames: 100_000, coveredMoves: 0, totalMoves: 1,
      evaluation: { scoreType: 'cp' as const, scoreValue: 500 },
    }
    const equal = {
      fen: 'equal', percent: 0, coveredGames: 0, totalGames: 3_000, coveredMoves: 0, totalMoves: 1,
      evaluation: { scoreType: 'cp' as const, scoreValue: 0 },
    }

    expect(coverageGapImpact(winning, 'white')).toBeLessThan(coverageGapImpact(equal, 'white'))
    expect(rankCoverageGaps([winning, equal], 'white').map((position) => position.fen)).toEqual(['equal', 'winning'])
    expect(rankCoverageGaps([winning, equal], 'black').map((position) => position.fen)).toEqual(['winning', 'equal'])
  })
})
