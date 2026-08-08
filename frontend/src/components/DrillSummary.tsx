import type { DrillSessionProgress } from '../lib/drillSessionLogic'

type Props = {
  progress: DrillSessionProgress
  onRetryFailed: () => void
  onNewSession: () => void
}

export function DrillSummary({ progress, onRetryFailed, onNewSession }: Props) {
  return (
    <div className="panel drill-summary">
      <h3>Session complete</h3>
      <p className="panel-status">
        {progress.perfectCount} perfect · {progress.failedCount} failed (of {progress.totalLines} line
        {progress.totalLines === 1 ? '' : 's'})
      </p>
      <div className="board-controls">
        {progress.failedCount > 0 && (
          <button type="button" onClick={onRetryFailed}>
            Retry failed
          </button>
        )}
        <button type="button" onClick={onNewSession}>
          New session
        </button>
      </div>
    </div>
  )
}
