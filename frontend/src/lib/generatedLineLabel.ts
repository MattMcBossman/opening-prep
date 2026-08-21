import { Chess } from 'chess.js'
import { canonicalMoveUci } from './chessUtils'

export function generatedLineSegments(pathUci: string[], basePly: number) {
  const game = new Chess()
  const san = pathUci.flatMap((uci) => {
    const canonical = canonicalMoveUci(uci)
    try {
      const move = game.move({
        from: canonical.slice(0, 2),
        to: canonical.slice(2, 4),
        promotion: canonical[4],
      })
      return move ? [move.san] : [uci]
    } catch {
      return [uci]
    }
  })
  const formatted = san.map((move, index) => (
    index % 2 === 0 ? `${Math.floor(index / 2) + 1}. ${move}` : move
  ))
  const split = Math.max(0, Math.min(basePly, formatted.length))
  return {
    starting: formatted.slice(0, split).join(' '),
    added: formatted.slice(split).join(' '),
  }
}

export function generatedLineLabel(pathUci: string[]) {
  const segments = generatedLineSegments(pathUci, 0)
  return segments.added
}
