import type { MoveFeatureComparison, PositionAnalysis, PositionFact, PositionFeatureSet } from '../types'
import type { MoveComparisonResult } from '../hooks/useEngineComparison'
import { PositionAnalysisPanel } from './PositionAnalysisPanel'

type Props = {
  leafPly: number
  positionAnalysis: PositionAnalysis | null
  positionAnalysisLoading: boolean
  positionAnalysisError: string | null
  positionFeatures: PositionFeatureSet | null
  positionFeaturesLoading: boolean
  positionFeaturesError: string | null
  moveComparison: MoveFeatureComparison | null
  moveComparisonLoading: boolean
  moveComparisonError: string | null
  selectedFactId: string | null
  onSelectFact: (fact: PositionFact | null) => void
  completionMoveQuality: MoveComparisonResult | null
}

/** The sole engine review shown after a line: cached/deepened MultiPV evidence. */
export function DrillLineCompletePanel({ leafPly, positionAnalysis, positionAnalysisLoading, positionAnalysisError, positionFeatures, positionFeaturesLoading, positionFeaturesError, moveComparison, moveComparisonLoading, moveComparisonError, selectedFactId, onSelectFact, completionMoveQuality }: Props) {
  return (
    <div className="panel drill-line-complete">
      <h3>Position analysis</h3>
      <PositionAnalysisPanel
        analysis={positionAnalysis}
        loading={positionAnalysisLoading}
        error={positionAnalysisError}
        leafPly={leafPly}
        features={positionFeatures}
        featuresLoading={positionFeaturesLoading}
        featuresError={positionFeaturesError}
        comparison={moveComparison}
        comparisonLoading={moveComparisonLoading}
        comparisonError={moveComparisonError}
        selectedFactId={selectedFactId}
        onSelectFact={onSelectFact}
        completionMoveQuality={completionMoveQuality}
      />
    </div>
  )
}
