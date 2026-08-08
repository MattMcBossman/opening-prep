export type AppMode = 'explorer' | 'drill'

type Props = {
  mode: AppMode
  onChange: (mode: AppMode) => void
}

export function ModeToggle({ mode, onChange }: Props) {
  return (
    <div className="mode-toggle" role="tablist" aria-label="App mode">
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'explorer'}
        className={mode === 'explorer' ? 'mode-toggle-button active' : 'mode-toggle-button'}
        onClick={() => onChange('explorer')}
      >
        Explorer
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'drill'}
        className={mode === 'drill' ? 'mode-toggle-button active' : 'mode-toggle-button'}
        onClick={() => onChange('drill')}
      >
        Drills
      </button>
    </div>
  )
}
