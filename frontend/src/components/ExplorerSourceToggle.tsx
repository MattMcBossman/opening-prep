import type { ExplorerSource } from '../hooks/useExplorerStats'

type Props = {
  source: ExplorerSource
  onChange: (source: ExplorerSource) => void
}

/** Always visible; signed-out selections explain which linked account the source requires. */
export function ExplorerSourceToggle({ source, onChange }: Props) {
  return (
    <div className="mode-toggle" role="tablist" aria-label="Explorer data source">
      <button
        type="button"
        role="tab"
        aria-selected={source === 'lichess'}
        className={source === 'lichess' ? 'mode-toggle-button active' : 'mode-toggle-button'}
        onClick={() => onChange('lichess')}
      >
        <span className="source-label-wide">Lichess database</span>
        <span className="source-label-compact">Lichess DB</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={source === 'my-games'}
        className={source === 'my-games' ? 'mode-toggle-button active' : 'mode-toggle-button'}
        onClick={() => onChange('my-games')}
      >
        My games
      </button>
    </div>
  )
}
