export type AppMode = 'explorer' | 'drill'

type Props = {
  mode: AppMode
  onChange: (mode: AppMode) => void
  guideTarget?: string
}

export function ModeToggle({ mode, onChange, guideTarget }: Props) {
  return (
    <div className="mode-toggle" role="tablist" aria-label="App mode" data-guide={guideTarget}>
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
