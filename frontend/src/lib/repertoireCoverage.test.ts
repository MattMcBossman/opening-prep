import { describe, expect, it } from 'vitest'
import { aggregatePositionCoverage, calculateModuleLeafCoverage, calculatePositionCoverage, coverageGapImpact, moduleCoverageScope, opponentPositions, rankCoverageGaps } from './repertoireCoverage'
import type { DrillLine } from './repertoireDrills'

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
  it('uses the listed module opening position and sums distinct leaf samples', () => {
    const common = [
      { fen: 'start', san: 'e4', uci: 'e2e4', resultingFen: 'after-e4 w - -', mover: 'own' as const },
      { fen: 'after-e4', san: 'e5', uci: 'e7e5', resultingFen: 'after-e5 b - -', mover: 'opponent' as const },
      { fen: 'after-e5', san: 'Nc3', uci: 'b1c3', resultingFen: 'vienna w - -', mover: 'own' as const },
    ]
    const lines: DrillLine[] = [
      { id: 'a', steps: [...common, { fen: 'vienna', san: 'Nf6', uci: 'g8f6', resultingFen: 'leaf-a b - -', mover: 'opponent' }] },
      { id: 'b', steps: [...common, { fen: 'vienna', san: 'Nc6', uci: 'b8c6', resultingFen: 'leaf-b b - -', mover: 'opponent' }] },
      { id: 'transpose', steps: [...common, { fen: 'vienna', san: 'Nc6', uci: 'b8c6', resultingFen: 'leaf-b b - -', mover: 'opponent' }] },
    ]
    const scope = moduleCoverageScope(lines, 'white')
    expect(scope).toEqual({ openingFen: 'vienna w - -', leafFens: ['leaf-a b - -', 'leaf-b b - -'], openingPly: 3 })
    expect(calculateModuleLeafCoverage(scope, {
      'vienna w - -': 1_000,
      'leaf-a b - -': 300,
      'leaf-b b - -': 450,
    })).toEqual({ leafGames: 750, openingGames: 1_000, percent: 75, leavesWithData: 2, totalLeaves: 2 })
  })

  it('falls back to the latest common ancestor when lines split before the listed opening depth', () => {
    const lines: DrillLine[] = [
      { id: 'e4', steps: [{ fen: 'start', san: 'e4', uci: 'e2e4', resultingFen: 'after-e4 b - -', mover: 'own' }] },
      { id: 'd4', steps: [{ fen: 'start', san: 'd4', uci: 'd2d4', resultingFen: 'after-d4 b - -', mover: 'own' }] },
    ]
    expect(moduleCoverageScope(lines, 'white').openingPly).toBe(0)
  })

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
