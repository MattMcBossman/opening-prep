import type { ImportPromptPhase } from '../hooks/useRepertoire'
import type { ImportSummary } from '../lib/repertoireApi'

type Props = {
  phase: ImportPromptPhase
  counts: ImportSummary | null
  onConfirm: () => void
  onDismiss: () => void
  onClose: () => void
}

/**
 * One-time offer, on first sign-in, to copy the anonymous localStorage
 * repertoire into the account (see useRepertoire's useImportPrompt). The local
 * copy is left untouched in every outcome - confirmed, dismissed, or failed.
 */
export function ImportRepertoirePrompt({ phase, counts, onConfirm, onDismiss, onClose }: Props) {
  if (phase === 'hidden') return null

  if (phase === 'result') {
    const importedTotal = (counts?.white.imported ?? 0) + (counts?.black.imported ?? 0)
    const skippedTotal = (counts?.white.skipped ?? 0) + (counts?.black.skipped ?? 0)
    return (
      <div className="panel import-prompt">
        <p className="panel-status">
          Imported {importedTotal} move{importedTotal === 1 ? '' : 's'} ({skippedTotal} already saved).
        </p>
        <div className="board-controls">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="panel import-prompt">
        <p className="panel-status error">Couldn't import your local repertoire. Your local copy is unaffected.</p>
        <div className="board-controls">
          <button type="button" onClick={onConfirm}>
            Retry
          </button>
          <button type="button" onClick={onClose}>
            Dismiss
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="panel import-prompt">
      <p className="panel-status">
        You have a repertoire saved in this browser. Import it into your account? Your local copy stays untouched
        either way.
      </p>
      <div className="board-controls">
        <button type="button" onClick={onConfirm}>
          Import
        </button>
        <button type="button" onClick={onDismiss}>
          Not now
        </button>
      </div>
    </div>
  )
}
