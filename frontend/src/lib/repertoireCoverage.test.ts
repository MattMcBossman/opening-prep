import { describe, expect, it } from 'vitest'
import { aggregatePositionCoverage, calculateLineCoverageProbabilities, calculateModuleCoveragePartition, calculateModuleLeafCoverage, calculatePositionCoverage, calculateRepertoireNodeProbabilities, clusterLeafCoverage, coverageGapImpact, coveragePositionLabel, leafPreparationScore, leafQualifiesForCoverage, moduleCoverageScope, opponentPositions, rankCoverageGaps } from './repertoireCoverage'

describe('coveragePositionLabel', () => {
  it('shows the complete continuation from the opening position when it fits', () => {
    expect(coveragePositionLabel(['Nc6', 'Bc4'], 3)).toBe('2...Nc6 3. Bc4')
  })

  it('keeps the first and last moves around an ellipsis for a long path', () => {
    expect(coveragePositionLabel(['Nc6', 'Bc4', 'Nf6', 'd3', 'Bc5', 'Nf3', 'd6', 'O-O', 'O-O'], 3))
      .toBe('2...Nc6 3. Bc4 Nf6 … 5...d6 6. O-O O-O')
  })

  it('labels an empty continuation as the opening position', () => {
    expect(coveragePositionLabel([], 3)).toBe('Opening position')
  })
})
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

  it('recognizes alternate Lichess castling UCI as a saved response', () => {
    const coverage = calculatePositionCoverage(
      [{ san: 'O-O', uci: 'e1h1', white: 50, draws: 20, black: 30, totalGames: 100 }],
      [{ san: 'O-O', uci: 'e1g1', resultingFen: 'castled' }],
      (fen) => fen === 'castled' ? [{ san: 'Nf6', uci: 'g8f6', resultingFen: 'next' }] : [],
    )
    expect(coverage).toMatchObject({ coveredGames: 100, coveredMoves: 1, percent: 100 })
  })
})

describe('coverage dashboard helpers', () => {
  it('clusters only close evaluations at the same ply and sums distinct-FEN frequency', () => {
    const points = [
      { fen: 'a', depth: 9, games: 100, frequency: 10, evaluation: { scoreType: 'cp' as const, scoreValue: 20 }, pathIds: ['a'] },
      { fen: 'b', depth: 9, games: 50, frequency: 5, evaluation: { scoreType: 'cp' as const, scoreValue: 30 }, pathIds: ['b'] },
      { fen: 'c', depth: 11, games: 50, frequency: 5, evaluation: { scoreType: 'cp' as const, scoreValue: 25 }, pathIds: ['c'] },
      { fen: 'd', depth: 9, games: 10, frequency: 1, evaluation: null, pathIds: ['d'] },
    ]
    const clusters = clusterLeafCoverage(points, 'white')
    expect(clusters).toHaveLength(2)
    expect(clusters[0]).toMatchObject({ depth: 9, frequency: 15 })
    expect(clusters[0].points.map((point) => point.fen)).toEqual(['a', 'b'])
    expect(clusters[1]).toMatchObject({ depth: 11, frequency: 5 })
  })

  it('clusters same-ply markers whose rendered boxes would overlap', () => {
    const points = [
      { fen: 'a', depth: 15, games: 1, frequency: 0.01, evaluation: { scoreType: 'cp' as const, scoreValue: 40 }, pathIds: ['a'] },
      { fen: 'b', depth: 15, games: 1, frequency: 0.01, evaluation: { scoreType: 'cp' as const, scoreValue: 95 }, pathIds: ['b'] },
      { fen: 'c', depth: 15, games: 1, frequency: 0.01, evaluation: { scoreType: 'cp' as const, scoreValue: 150 }, pathIds: ['c'] },
      { fen: 'd', depth: 15, games: 1, frequency: 0.01, evaluation: { scoreType: 'cp' as const, scoreValue: 420 }, pathIds: ['d'] },
    ]
    const clusters = clusterLeafCoverage(points, 'white')
    expect(clusters).toHaveLength(3)
    expect(clusters.map((cluster) => cluster.points.map((point) => point.fen))).toEqual([['d'], ['c'], ['a', 'b']])
  })

  it('keeps moderately close evaluations separate with compact plot markers', () => {
    const points = [
      { fen: 'a', depth: 15, games: 1, frequency: 1, evaluation: { scoreType: 'cp' as const, scoreValue: 20 }, pathIds: ['a'] },
      { fen: 'b', depth: 15, games: 1, frequency: 1, evaluation: { scoreType: 'cp' as const, scoreValue: 140 }, pathIds: ['b'] },
    ]
    expect(clusterLeafCoverage(points, 'white')).toHaveLength(2)
  })

  it('does not transitively merge a dense evaluation range into one wide cluster', () => {
    const points = Array.from({ length: 14 }, (_, index) => ({
      fen: `vienna-${index}`,
      depth: 7,
      games: 1,
      frequency: 1,
      evaluation: { scoreType: 'cp' as const, scoreValue: index * 10 },
      pathIds: [`vienna-${index}`],
    }))
    const clusters = clusterLeafCoverage(points, 'white')
    expect(clusters.length).toBeGreaterThan(1)
    for (const cluster of clusters) {
      const evaluations = cluster.points.map((point) => point.evaluation!.scoreValue / 100)
      expect(Math.max(...evaluations) - Math.min(...evaluations)).toBeLessThanOrEqual(0.58)
    }
  })

  it('keeps visually identical rounded evaluations in the same collision cluster', () => {
    const points = [0, 0, 0, 30, 55, 64].map((scoreValue, index) => ({
      fen: `vienna-25-${index}`,
      depth: 25,
      games: 1,
      frequency: 1,
      evaluation: { scoreType: 'cp' as const, scoreValue },
      pathIds: [`vienna-25-${index}`],
    }))
    const clusters = clusterLeafCoverage(points, 'white')
    expect(clusters).toHaveLength(2)
    expect(clusters.some((cluster) => cluster.points.map((point) => point.fen).includes('vienna-25-4')
      && cluster.points.map((point) => point.fen).includes('vienna-25-5'))).toBe(true)
  })
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
    const probabilities = calculateLineCoverageProbabilities(lines, scope.openingPly, {
      'vienna': {
        totalGames: 1_000,
        moves: [
          { san: 'Nf6', uci: 'g8f6', white: 0, draws: 0, black: 0, totalGames: 300 },
          { san: 'Nc6', uci: 'b8c6', white: 0, draws: 0, black: 0, totalGames: 450 },
        ],
      },
    })
    expect(calculateModuleLeafCoverage(probabilities)).toEqual({
      coveredProbability: 0.75,
      preparedProbability: 0.75,
      percent: 100,
      linesWithData: 2,
      totalLines: 2,
    })
  })

  it('multiplies opponent response rates and completely ignores our move popularity', () => {
    const lines: DrillLine[] = [{ id: 'line', steps: [
      { fen: 'opening', san: 'Rare', uci: 'a2a3', resultingFen: 'after-own', mover: 'own' },
      { fen: 'after-own', san: 'Reply', uci: 'a7a6', resultingFen: 'after-reply', mover: 'opponent' },
      { fen: 'after-reply', san: 'Rare2', uci: 'b2b3', resultingFen: 'after-own-2', mover: 'own' },
      { fen: 'after-own-2', san: 'Reply2', uci: 'b7b6', resultingFen: 'leaf', mover: 'opponent' },
    ] }]
    const probabilities = calculateLineCoverageProbabilities(lines, 0, {
      'opening': { totalGames: 1_000_000, moves: [] },
      'after-own': { totalGames: 1_000, moves: [{ san: 'Reply', uci: 'a7a6', white: 0, draws: 0, black: 0, totalGames: 600 }] },
      'after-own-2': { totalGames: 300, moves: [{ san: 'Reply2', uci: 'b7b6', white: 0, draws: 0, black: 0, totalGames: 75 }] },
    })
    expect(probabilities[0]).toMatchObject({ probability: 0.15, minimumSample: 300, hasAllData: true })
    expect(calculateModuleLeafCoverage(probabilities).percent).toBe(100)
  })

  it('normalizes qualifying probability against the selected module rather than all opponent play', () => {
    const lines = [
      { lineId: 'main', leafFen: 'a', probability: 0.375, minimumSample: 100, hasAllData: true },
      { lineId: 'side', leafFen: 'b', probability: 0.125, minimumSample: 100, hasAllData: true },
    ]
    expect(calculateModuleLeafCoverage(lines, (line) => line.lineId === 'main')).toEqual({
      coveredProbability: 0.375,
      preparedProbability: 0.5,
      percent: 75,
      linesWithData: 1,
      totalLines: 2,
    })
  })

  it('partitions sampled probability into covered leaves and unprepared opponent replies', () => {
    const lines: DrillLine[] = [{ id: 'prepared', steps: [
      { fen: 'opening', san: 'Own', uci: 'a2a3', resultingFen: 'reply-origin', mover: 'own' },
      { fen: 'reply-origin', san: 'Prepared', uci: 'a7a6', resultingFen: 'response-origin', mover: 'opponent' },
      { fen: 'response-origin', san: 'Response', uci: 'b2b3', resultingFen: 'leaf', mover: 'own' },
    ] }]
    const result = calculateModuleCoveragePartition(
      lines,
      0,
      { 'reply-origin': { totalGames: 100, moves: [
        { san: 'Prepared', uci: 'a7a6', white: 0, draws: 0, black: 0, totalGames: 60 },
        { san: 'Missing', uci: 'b7b6', white: 0, draws: 0, black: 0, totalGames: 40 },
      ] } },
      { leaf: { scoreType: 'cp', scoreValue: 0 } },
      'white',
      { minimumScore: 0, evaluationWeight: 0, minimumEvaluation: -10 },
    )
    expect(result).toEqual({
      coveredProbability: 0.6,
      failingLeafProbability: 0,
      unpreparedProbability: 0.4,
      unknownProbability: 0,
      percent: 60,
    })
  })

  it('treats the unlisted explorer tail as uncovered when a rare prepared reply is omitted', () => {
    const lines: DrillLine[] = [{ id: 'rare', steps: [
      { fen: 'origin', san: 'Rare', uci: 'a7a5', resultingFen: 'leaf', mover: 'opponent' },
    ] }]
    const result = calculateModuleCoveragePartition(
      lines,
      0,
      { origin: { totalGames: 100, moves: [
        { san: 'Common', uci: 'a7a6', white: 0, draws: 0, black: 0, totalGames: 80 },
      ] } },
      { leaf: { scoreType: 'cp', scoreValue: 0 } },
      'white',
      { minimumScore: 0, evaluationWeight: 0, minimumEvaluation: -10 },
    )
    expect(result).toEqual({
      coveredProbability: 0,
      failingLeafProbability: 0,
      unpreparedProbability: 1,
      unknownProbability: 0,
      percent: 0,
    })
  })

  it('counts prepared leaves below the configured score as uncovered', () => {
    const lines: DrillLine[] = [{ id: 'line', steps: [
      { fen: 'origin', san: 'Reply', uci: 'a7a6', resultingFen: 'leaf', mover: 'opponent' },
    ] }]
    const result = calculateModuleCoveragePartition(
      lines,
      0,
      { origin: { totalGames: 100, moves: [{ san: 'Reply', uci: 'a7a6', white: 0, draws: 0, black: 0, totalGames: 100 }] } },
      { leaf: { scoreType: 'cp', scoreValue: 0 } },
      'white',
      { minimumScore: 16, evaluationWeight: 6, minimumEvaluation: -1 },
    )
    expect(result).toMatchObject({ coveredProbability: 0, failingLeafProbability: 1, percent: 0 })
  })

  it('scores a position by its full game ply regardless of the coverage opening', () => {
    const lines: DrillLine[] = [{ id: 'line', steps: [
      { fen: 'start', san: 'First', uci: 'a2a3', resultingFen: 'ply-1', mover: 'own' },
      { fen: 'ply-1', san: 'Second', uci: 'a7a6', resultingFen: 'ply-2', mover: 'own' },
      { fen: 'ply-2', san: 'Third', uci: 'b2b3', resultingFen: 'module-opening', mover: 'own' },
      { fen: 'module-opening', san: 'Fourth', uci: 'b7b6', resultingFen: 'same-position', mover: 'own' },
    ] }]
    const parameters = { minimumScore: 4, evaluationWeight: 0, minimumEvaluation: -10 }
    const evaluations = { 'same-position': { scoreType: 'cp' as const, scoreValue: 0 } }

    const moduleCoverage = calculateModuleCoveragePartition(lines, 3, {}, evaluations, 'white', parameters)
    const fullCoverage = calculateModuleCoveragePartition(lines, 0, {}, evaluations, 'white', parameters)

    expect(moduleCoverage.percent).toBe(100)
    expect(moduleCoverage).toEqual(fullCoverage)
  })

  it('does not penalize a qualifying internal node for optional prepared continuations', () => {
    const lines: DrillLine[] = [{ id: 'line', steps: [
      { fen: 'opening', san: 'Own', uci: 'a2a3', resultingFen: 'prepared', mover: 'own' },
      { fen: 'prepared', san: 'Reply', uci: 'a7a6', resultingFen: 'leaf', mover: 'opponent' },
    ] }]
    const result = calculateModuleCoveragePartition(
      lines,
      0,
      { prepared: { totalGames: 100, moves: [
        { san: 'Reply', uci: 'a7a6', white: 0, draws: 0, black: 0, totalGames: 10 },
        { san: 'Missing', uci: 'b7b6', white: 0, draws: 0, black: 0, totalGames: 90 },
      ] } },
      {
        prepared: { scoreType: 'cp', scoreValue: 0 },
        leaf: { scoreType: 'cp', scoreValue: 0 },
      },
      'white',
      { minimumScore: 1, evaluationWeight: 0, minimumEvaluation: -10 },
    )
    expect(result).toEqual({
      coveredProbability: 1,
      failingLeafProbability: 0,
      unpreparedProbability: 0,
      unknownProbability: 0,
      percent: 100,
    })
  })

  it('does not qualify a position reached by an opponent move', () => {
    const lines: DrillLine[] = [{ id: 'line', steps: [
      { fen: 'origin', san: 'Reply', uci: 'a7a6', resultingFen: 'opponent-node', mover: 'opponent' },
      { fen: 'opponent-node', san: 'Own', uci: 'a2a3', resultingFen: 'leaf', mover: 'own' },
    ] }]
    const result = calculateModuleCoveragePartition(
      lines,
      0,
      { origin: { totalGames: 100, moves: [
        { san: 'Reply', uci: 'a7a6', white: 0, draws: 0, black: 0, totalGames: 100 },
      ] } },
      { 'opponent-node': { scoreType: 'cp', scoreValue: 0 } },
      'white',
      { minimumScore: 1, evaluationWeight: 0, minimumEvaluation: -10 },
    )
    expect(result).toMatchObject({
      coveredProbability: 0,
      failingLeafProbability: 1,
      unpreparedProbability: 0,
      percent: 0,
    })
  })

  it('does not invent partial line coverage when an opponent decision snapshot is missing', () => {
    const lines: DrillLine[] = [{ id: 'line', steps: [
      { fen: 'first', san: 'Reply', uci: 'a7a6', resultingFen: 'second', mover: 'opponent' },
      { fen: 'second', san: 'Reply2', uci: 'b7b6', resultingFen: 'leaf', mover: 'opponent' },
    ] }]
    const [result] = calculateLineCoverageProbabilities(lines, 0, {
      first: { totalGames: 100, moves: [{ san: 'Reply', uci: 'a7a6', white: 0, draws: 0, black: 0, totalGames: 50 }] },
    })
    expect(result).toMatchObject({ probability: 0, hasAllData: false })
  })

  it('requires score 15 with evaluation weight 10 and rejects evaluations worse than minus one', () => {
    expect(leafPreparationScore(15, { scoreType: 'cp', scoreValue: 0 }, 'white')).toBe(15)
    expect(leafQualifiesForCoverage(15, { scoreType: 'cp', scoreValue: 0 }, 'white')).toBe(true)
    expect(leafQualifiesForCoverage(24, { scoreType: 'cp', scoreValue: -100 }, 'white')).toBe(false)
    expect(leafQualifiesForCoverage(25, { scoreType: 'cp', scoreValue: -100 }, 'white')).toBe(true)
    expect(leafQualifiesForCoverage(100, { scoreType: 'cp', scoreValue: -101 }, 'white')).toBe(false)
    expect(leafQualifiesForCoverage(24, { scoreType: 'cp', scoreValue: 100 }, 'black')).toBe(false)
    expect(leafQualifiesForCoverage(1, { scoreType: 'mate', scoreValue: 3 }, 'white')).toBe(true)
    expect(leafQualifiesForCoverage(100, { scoreType: 'mate', scoreValue: -3 }, 'white')).toBe(false)
  })

  it('enumerates shared internal prefixes once and retains transposed path occurrences', () => {
    const common = [
      { fen: 'opening', san: 'Own', uci: 'a2a3', resultingFen: 'shared', mover: 'own' as const },
      { fen: 'shared', san: 'Reply', uci: 'a7a6', resultingFen: 'branch', mover: 'opponent' as const },
    ]
    const lines: DrillLine[] = [
      { id: 'a', steps: [...common, { fen: 'branch', san: 'A', uci: 'b2b3', resultingFen: 'transpose', mover: 'own' }] },
      { id: 'b', steps: [...common, { fen: 'branch', san: 'B', uci: 'c2c3', resultingFen: 'other', mover: 'own' }, { fen: 'other', san: 'Reply2', uci: 'b7b6', resultingFen: 'transpose', mover: 'opponent' }] },
    ]
    const nodes = calculateRepertoireNodeProbabilities(lines, 0, {
      shared: { totalGames: 100, moves: [{ san: 'Reply', uci: 'a7a6', white: 0, draws: 0, black: 0, totalGames: 60 }] },
      other: { totalGames: 30, moves: [{ san: 'Reply2', uci: 'b7b6', white: 0, draws: 0, black: 0, totalGames: 15 }] },
    })
    expect(nodes).toHaveLength(5)
    expect(nodes.filter((node) => node.fen === 'branch')).toHaveLength(1)
    expect(nodes.filter((node) => node.fen === 'transpose').map((node) => node.probability)).toEqual([0.3, 0.15])
    expect(nodes.filter((node) => node.isLeaf)).toHaveLength(2)
    expect(nodes.filter((node) => node.mover === 'own').reduce((sum, node) => sum + node.exclusiveProbability, 0)).toBe(1)
  })

  it('partitions position coverage without repeating child probability', () => {
    const lines: DrillLine[] = [{ id: 'line', steps: [
      { fen: 'opening', san: 'Reply', uci: 'a7a6', resultingFen: 'respond', mover: 'opponent' },
      { fen: 'respond', san: 'Prepared', uci: 'a2a3', resultingFen: 'prepared-one', mover: 'own' },
      { fen: 'prepared-one', san: 'Reply2', uci: 'b7b6', resultingFen: 'respond-two', mover: 'opponent' },
      { fen: 'respond-two', san: 'Prepared2', uci: 'b2b3', resultingFen: 'prepared-two', mover: 'own' },
    ] }]
    const nodes = calculateRepertoireNodeProbabilities(lines, 0, {
      opening: { totalGames: 100, moves: [{ san: 'Reply', uci: 'a7a6', white: 0, draws: 0, black: 0, totalGames: 60 }] },
      'prepared-one': { totalGames: 60, moves: [{ san: 'Reply2', uci: 'b7b6', white: 0, draws: 0, black: 0, totalGames: 30 }] },
    })
    const own = nodes.filter((node) => node.mover === 'own')
    expect(own.map((node) => node.exclusiveProbability)).toEqual([0.3, 0.3])
    expect(own.reduce((sum, node) => sum + node.exclusiveProbability, 0) + 0.4).toBe(1)
  })

  it('falls back to the latest common ancestor when lines split before the listed opening depth', () => {
    const lines: DrillLine[] = [
      { id: 'e4', steps: [{ fen: 'start', san: 'e4', uci: 'e2e4', resultingFen: 'after-e4 b - -', mover: 'own' }] },
      { id: 'd4', steps: [{ fen: 'start', san: 'd4', uci: 'd2d4', resultingFen: 'after-d4 b - -', mover: 'own' }] },
    ]
    expect(moduleCoverageScope(lines, 'white').openingPly).toBe(0)
    expect(moduleCoverageScope(lines, 'white', true)).toMatchObject({ openingPly: 1, openingFen: 'after-e4 b - -' })
    expect(moduleCoverageScope(lines, 'black', true).openingPly).toBe(0)
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
