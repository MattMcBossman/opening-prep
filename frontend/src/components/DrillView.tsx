import { useCallback, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Chessboard } from 'react-chessboard'
import type { Arrow, PieceDropHandlerArgs, SquareHandlerArgs } from 'react-chessboard'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import { useDrillSession } from '../hooks/useDrillSession'
import { useRepertoire } from '../hooks/useRepertoire'
import { sideToMove } from '../lib/chessUtils'
import type { RepertoireColor } from '../types'
import { DrillFeedbackPanel } from './DrillFeedbackPanel'
import { DrillLineCompletePanel } from './DrillLineCompletePanel'
import { DrillSummary } from './DrillSummary'
import { BoardColorToggle } from './BoardColorToggle'

type Props = {
  repertoire: ReturnType<typeof useRepertoire>
  color: RepertoireColor
  onToggleColor: () => void
  /** Plays the audio cue for a move, given its SAN. Owned by App so the mute toggle is shared. */
  playMoveSound: (san: string) => void
  /** Plays the distinct "drill complete" chime, independent of any move's own cue. */
  playDrillCompleteSound: () => void
}

const SELECTED_SQUARE_STYLE: CSSProperties = { backgroundColor: 'rgba(255, 235, 59, 0.5)' }
const LEGAL_TARGET_STYLE: CSSProperties = {
  backgroundImage: 'radial-gradient(circle, rgba(0, 0, 0, 0.3) 22%, transparent 24%)',
}
const CAPTURE_TARGET_STYLE: CSSProperties = { boxShadow: 'inset 0 0 0 4px rgba(0, 0, 0, 0.35)' }
// Progressive wrong-attempt hints (2nd attempt: origin square, 3rd+: origin + destination).
const HINT_SQUARE_STYLE: CSSProperties = { boxShadow: 'inset 0 0 0 4px rgba(76, 175, 80, 0.65)' }
// Distinct from the green save-hint squares above - this is a warning about an
// unprepped opponent try, not a hint about the user's own next move.
const BEST_RESPONSE_ARROW_COLOR = '#e0672a'

/**
 * Drill mode: practices saved repertoire lines for `color`, isolated from the
 * explorer's own `useGame`/board state (see the Phase 3 plan's "Risks and
 * decisions" - drilling must never mutate the repertoire).
 */
export function DrillView({ repertoire, color, onToggleColor, playMoveSound, playDrillCompleteSound }: Props) {
  const getContinuations = useCallback((fen: string) => repertoire.getContinuations(color, fen), [repertoire, color])
  const onStepApplied = useCallback((step: { san: string }) => playMoveSound(step.san), [playMoveSound])
  const session = useDrillSession({
    color,
    getContinuations,
    onStepApplied,
    onLineComplete: playDrillCompleteSound,
  })
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null)

  const { state } = session
  const fen = state.currentFen
  const isOwnTurn = sideToMove(fen) === color
  const feedback = state.lastFeedback
  const isPaused = state.completionPause !== null

  const legalMoves = useMemo(() => {
    if (!selectedSquare) return []
    try {
      return new Chess(fen).moves({ square: selectedSquare as Square, verbose: true })
    } catch {
      return []
    }
  }, [fen, selectedSquare])

  const squareStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = {}
    if (selectedSquare) {
      styles[selectedSquare] = SELECTED_SQUARE_STYLE
      for (const move of legalMoves) {
        styles[move.to] = { ...styles[move.to], ...(move.isCapture() ? CAPTURE_TARGET_STYLE : LEGAL_TARGET_STYLE) }
      }
    }
    if (feedback?.kind === 'wrong') {
      if (feedback.hintFrom) styles[feedback.hintFrom] = { ...styles[feedback.hintFrom], ...HINT_SQUARE_STYLE }
      if (feedback.hintTo) styles[feedback.hintTo] = { ...styles[feedback.hintTo], ...HINT_SQUARE_STYLE }
    }
    return styles
  }, [selectedSquare, legalMoves, feedback])

  // Drawn only while paused after completing a line - the opponent's best try
  // in a position the user hasn't prepped a reply to yet (see DrillLineCompletePanel).
  const arrows = useMemo<Arrow[]>(() => {
    const bestMoveUci = isPaused ? session.completionEval?.bestMoveUci : null
    if (!bestMoveUci) return []
    return [
      {
        startSquare: bestMoveUci.slice(0, 2),
        endSquare: bestMoveUci.slice(2, 4),
        color: BEST_RESPONSE_ARROW_COLOR,
      },
    ]
  }, [isPaused, session.completionEval])

  const tryMove = useCallback(
    (candidate: { from: string; to: string; promotion?: string }): boolean => {
      if (!isOwnTurn || session.complete || isPaused) return false
      const trial = new Chess(fen)
      let result
      try {
        result = trial.move(candidate)
      } catch {
        return false
      }
      if (!result) return false
      const uci = `${result.from}${result.to}${result.promotion ?? ''}`
      // Decide the drop outcome *before* dispatching: a legal move is only ever
      // accepted (piece stays) when it will actually advance the position - a
      // genuine mistake and a saved-but-already-drilled rejection both leave the
      // position unchanged, so the piece should snap back in either case.
      const accepted = session.wouldAccept(uci)
      // Sounds (the move itself, its auto-played opponent reply, and the
      // drill-complete chime) are handled by useDrillSession's onStepApplied/
      // onLineComplete callbacks, timed to when each ply actually lands on the
      // board - see AUTO_PLAY_DELAY_MS.
      session.attemptMove({ uci, san: result.san, resultingFen: trial.fen() })
      return accepted
    },
    [fen, isOwnTurn, session, isPaused],
  )

  function handlePieceDrop({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean {
    if (!targetSquare) return false
    // A wrong-but-legal move is deliberately never applied to `fen` (see
    // drillSessionLogic) - returning false here also makes react-chessboard snap
    // the dragged piece straight back, satisfying the "move the piece back" part
    // of the Phase 3 plan's wrong-move feedback without any extra animation code.
    return tryMove({ from: sourceSquare, to: targetSquare, promotion: 'q' })
  }

  function handleSquareClick({ square, piece }: SquareHandlerArgs) {
    if (!selectedSquare) {
      if (piece) setSelectedSquare(square)
      return
    }
    if (square === selectedSquare) {
      setSelectedSquare(null)
      return
    }
    const moved = tryMove({ from: selectedSquare, to: square, promotion: 'q' })
    setSelectedSquare(moved ? null : piece ? square : null)
  }

  if (state.lines.length === 0) {
    return (
      <div className="panel drill-empty">
        <p className="panel-status">
          No saved {color} repertoire yet. Save some moves in the explorer first, then come back to drill them.
        </p>
      </div>
    )
  }

  const progressLabel = session.progress.isRetryPass ? 'Retrying failed drill' : 'Drill'

  return (
    <div className="drill-layout">
      <div className="board-column">
        <div className="board-heading">
          <div className="drill-progress">
            <span>
              {progressLabel} {session.progress.currentDrillNumber} of {session.progress.totalLines}
            </span>
            <span className="drill-progress-results">
              {session.progress.perfectCount} perfect · {session.progress.failedCount} failed
            </span>
          </div>
          <BoardColorToggle boardColor={color} onToggle={onToggleColor} />
        </div>
        <div className="board-wrapper">
          <Chessboard
            options={{
              position: fen,
              boardOrientation: color,
              onPieceDrop: handlePieceDrop,
              onSquareClick: handleSquareClick,
              squareStyles,
              arrows,
              showAnimations: true,
              animationDurationInMs: 300,
              id: 'opening-prep-drill-board',
            }}
          />
        </div>
        <div className="board-controls">
          <button type="button" onClick={session.startNewSession}>
            Restart session
          </button>
        </div>
      </div>
      <div className="side-column">
        {isPaused ? (
          <DrillLineCompletePanel
            evaluation={session.completionEval}
            leafPly={state.completionPause?.leafPly ?? 0}
            isLastDrill={session.complete}
            onNext={session.acknowledgeCompletion}
          />
        ) : session.complete ? (
          <DrillSummary
            progress={session.progress}
            onRetryFailed={session.retryFailed}
            onNewSession={session.startNewSession}
          />
        ) : (
          <div className="panel drill-feedback-panel">
            <DrillFeedbackPanel feedback={feedback} similarPosition={session.similarPosition} />
          </div>
        )}
      </div>
    </div>
  )
}
