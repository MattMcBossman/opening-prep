import type { BoardColor } from '../hooks/useBoardColor'

type Props = {
  boardColor: BoardColor
  onToggle: () => void
}

export function BoardColorToggle({ boardColor, onToggle }: Props) {
  const isBlack = boardColor === 'black'
  const label = isBlack ? 'Black repertoire' : 'White repertoire'

  return (
    <button
      type="button"
      className="board-color-toggle"
      role="switch"
      aria-checked={isBlack}
      onClick={onToggle}
      title={`Viewing from ${boardColor}'s side`}
    >
      <span className="board-color-toggle-track">
        <span className="board-color-toggle-thumb" />
      </span>
      <span className="board-color-toggle-label">{label}</span>
    </button>
  )
}
