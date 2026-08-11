import { useMemo } from 'react'
import { formatMoveListFromPly, uciLineToSan } from '../lib/chessUtils'
import { formatScore } from '../lib/formatScore'
import { ENGINE_DISPLAY_NAME } from '../lib/engineEvaluationCache'
import { describeRecurringMove } from '../lib/positionAnalysis'
import { describePositionEvaluation } from '../lib/drillPositionAssessment'
import type { AnalysisCandidate, MoveFeatureComparison, PositionAnalysis, PositionFact, PositionFeatureSet } from '../types'
import type { MoveComparisonResult } from '../hooks/useEngineComparison'

type Props = {
  analysis: PositionAnalysis | null
  loading: boolean
  error: string | null
  leafPly: number
  features: PositionFeatureSet | null
  featuresLoading: boolean
  featuresError: string | null
  comparison: MoveFeatureComparison | null
  comparisonLoading: boolean
  comparisonError: string | null
  selectedFactId: string | null
  onSelectFact: (fact: PositionFact | null) => void
  completionMoveQuality: MoveComparisonResult | null
}

function candidateScore(candidate: AnalysisCandidate, fen: string): string {
  return formatScore({
    fen,
    depth: candidate.depth,
    scoreType: candidate.scoreType,
    scoreValue: candidate.scoreValue,
    bestMoveUci: candidate.bestMoveUci,
    pvUci: candidate.pvUci,
    thinking: false,
  })
}

export function PositionAnalysisPanel({ analysis, loading, error, leafPly, features, featuresLoading, featuresError, comparison, comparisonLoading, comparisonError, selectedFactId, onSelectFact, completionMoveQuality }: Props) {
  const lines = useMemo(() => analysis?.candidates.map((candidate) => ({
    ...candidate,
    text: formatMoveListFromPly(leafPly, uciLineToSan(analysis.fen, candidate.pvUci)),
  })) ?? [], [analysis, leafPly])

  if (loading && !analysis) {
    return <section className="position-analysis" aria-live="polite"><p className="panel-status">Building a deeper cached review…</p></section>
  }
  if (error && !analysis) {
    return <section className="position-analysis"><p className="panel-status error">Deeper review unavailable: {error}</p></section>
  }
  if (!analysis) return null
  const best = analysis.candidates.find((candidate) => candidate.rank === 1) ?? analysis.candidates[0]
  const bestEvaluation = best ? {
    fen: analysis.fen,
    depth: best.depth,
    scoreType: best.scoreType,
    scoreValue: best.scoreValue,
    bestMoveUci: best.bestMoveUci,
    pvUci: best.pvUci,
    thinking: false,
  } : null

  return (
    <section className="position-analysis" aria-label="Cached position analysis">
      {bestEvaluation && <p className="drill-line-complete-eval">{describePositionEvaluation(bestEvaluation)}</p>}
      {loading && <p className="panel-status">Showing the cached review while Stockfish deepens it to depth 24…</p>}
      <h4>Candidate continuations</h4>
      <p className="score-label">{ENGINE_DISPLAY_NAME} · MultiPV {analysis.multiPv} · depth {analysis.depth}</p>
      <ol className="analysis-candidates">
        {lines.map((candidate) => (
          <li key={candidate.rank}>
            <strong>{candidateScore(candidate, analysis.fen)}</strong>{' '}
            <span className="analysis-candidate-move">{uciLineToSan(analysis.fen, [candidate.bestMoveUci])[0] ?? candidate.bestMoveUci}</span>
            <span className="engine-line" title={candidate.text}>{candidate.text}</span>
          </li>
        ))}
      </ol>
      {(best?.scoreType === 'mate' || (completionMoveQuality?.cpLoss ?? 0) >= 100) && (
        <div className="position-analysis-warnings" role="status">
          {best?.scoreType === 'mate' && <p>Stockfish sees a forced mate from this position.</p>}
          {(completionMoveQuality?.cpLoss ?? 0) >= 100 && (
            <p>The final move caused a major evaluation swing of about {(completionMoveQuality!.cpLoss / 100).toFixed(1)} pawns.</p>
          )}
        </div>
      )}
      {analysis.recurringMoves.length > 0 && (
        <div className="analysis-recurring">
          <h4>Moves recurring across candidates</h4>
          <ul>
            {analysis.recurringMoves.slice(0, 3).map((move) => (
              <li key={`${move.side}-${move.uci}`}>
                {describeRecurringMove(analysis.fen, move)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="position-facts">
        <h4>Concrete board facts</h4>
        <p className="score-label">Select a fact to highlight its evidence on the board.</p>
        {featuresLoading && !features && <p className="panel-status">Checking the board…</p>}
        {featuresError && !features && <p className="panel-status error">Board facts unavailable: {featuresError}</p>}
        {features && features.facts.length === 0 && <p className="panel-status">No notable concrete facts found yet.</p>}
        {features && features.facts.length > 0 && (
          <ul>
            {features.facts.map((fact) => (
              <li key={fact.id}>
                <button
                  type="button"
                  className={`position-fact position-fact-${fact.severity}`}
                  aria-pressed={selectedFactId === fact.id}
                  onClick={() => onSelectFact(selectedFactId === fact.id ? null : fact)}
                >
                <span>{fact.summary}</span>
                {fact.squares.length > 0 && <small>Evidence: {fact.squares.join(', ')}</small>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="position-facts position-feature-diff">
        <h4>What the final move changed</h4>
        {comparisonLoading && !comparison && <p className="panel-status">Comparing the two positions…</p>}
        {comparisonError && !comparison && <p className="panel-status error">Position comparison unavailable: {comparisonError}</p>}
        {comparison && comparison.addedFacts.length === 0 && comparison.removedFacts.length === 0 && (
          <p className="panel-status">{comparison.moveSan} did not change any currently tracked concrete facts.</p>
        )}
        {comparison && (comparison.addedFacts.length > 0 || comparison.removedFacts.length > 0) && (
          <ul>
            {comparison.addedFacts.map((fact) => (
              <li key={`added-${fact.id}`} className="position-fact-change position-fact-change-added">
                <strong>Created</strong><span>{fact.summary}</span>
              </li>
            ))}
            {comparison.removedFacts.map((fact) => (
              <li key={`removed-${fact.id}`} className="position-fact-change position-fact-change-removed">
                <strong>Resolved</strong><span>{fact.summary}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
