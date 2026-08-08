type Props = {
  soundEnabled: boolean
  onToggle: () => void
}

/** Move-audio switch; like ThemeToggle, likely to move into user settings once those exist. */
export function SoundToggle({ soundEnabled, onToggle }: Props) {
  return (
    <button
      type="button"
      className="header-toggle"
      role="switch"
      aria-checked={soundEnabled}
      onClick={onToggle}
      title={soundEnabled ? 'Mute move sounds' : 'Unmute move sounds'}
    >
      <span className="header-toggle-track">
        <span className="header-toggle-thumb" />
      </span>
      <span className="header-toggle-label">{soundEnabled ? '\u266a Sound' : '\u266a Muted'}</span>
    </button>
  )
}
