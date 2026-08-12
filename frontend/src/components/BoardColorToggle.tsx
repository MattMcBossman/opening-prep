import type { BoardColor } from '../hooks/useBoardColor'

type Props = {
  boardColor: BoardColor
  onToggle: () => void
}

export function BoardColorToggle({ boardColor, onToggle }: Props) {
  const isBlack = boardColor === 'black'
  const label = isBlack ? 'Black' : 'White'

  return (
    <button
      type="button"
      className="board-color-toggle"
      role="switch"
      aria-checked={isBlack}
      onClick={onToggle}
      aria-label={`${label} module; switch to ${isBlack ? 'White' : 'Black'}`}
      title={`Switch to ${isBlack ? 'White' : 'Black'}`}
    >
      <span className="board-color-toggle-track">
        <span className="board-color-toggle-thumb" />
        <span className="board-color-toggle-value">{label}</span>
      </span>
    </button>
  )
}
