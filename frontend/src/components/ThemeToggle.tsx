import type { Theme } from '../hooks/useTheme'

type Props = {
  theme: Theme
  onToggle: () => void
}

/** Temporary theme switch, likely to move into user settings once those exist. */
export function ThemeToggle({ theme, onToggle }: Props) {
  const isDark = theme === 'dark'

  return (
    <button
      type="button"
      className="header-toggle"
      role="switch"
      aria-checked={isDark}
      onClick={onToggle}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <span className="header-toggle-track">
        <span className="header-toggle-thumb" />
      </span>
      <span className="header-toggle-label">{isDark ? 'Dark' : 'Light'}</span>
    </button>
  )
}
