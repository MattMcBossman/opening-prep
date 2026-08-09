import type { ExplorerSource } from '../hooks/useExplorerStats'

type Props = {
  source: ExplorerSource
  onChange: (source: ExplorerSource) => void
}

/** Only rendered for signed-in users - see App.tsx (the "my games" source needs a linked Lichess account). */
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
        Lichess database
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
