import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Chessboard } from 'react-chessboard'
import type { Arrow, PieceDropHandlerArgs, SquareHandlerArgs } from 'react-chessboard'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import { useDrillSession } from '../hooks/useDrillSession'
import { useDrillSessionRecording } from '../hooks/useDrillSessionRecording'
import { useExplorerStats } from '../hooks/useExplorerStats'
import { useDrillFollowupStats } from '../hooks/useDrillFollowupStats'
import { useRepertoire } from '../hooks/useRepertoire'
import { denormalizeFen, sideToMove } from '../lib/chessUtils'
import { completedDrillHistoryUci } from '../lib/repertoireDrills'
import { canonicalArrowUci, commonContinuations, continuationArrowColor, playerContinuationArrowColor } from '../lib/drillPositionAssessment'
import type { DrillLine, DrillStartContext, DrillStartMode } from '../lib/repertoireDrills'
import type { AuthUser } from '../lib/authApi'
import type { RepertoireColor } from '../types'
import { DrillFeedbackPanel } from './DrillFeedbackPanel'
import { DrillLineCompletePanel } from './DrillLineCompletePanel'
import { DrillSummary } from './DrillSummary'
import { BoardColorToggle } from './BoardColorToggle'
import { EvalBar } from './EvalBar'
import { ExplorerStatsTable } from './ExplorerStatsTable'

type Props = {
  repertoire: ReturnType<typeof useRepertoire>
  color: RepertoireColor
  onToggleColor: () => void
  /** Plays the audio cue for a move, given its SAN. Owned by App so the mute toggle is shared. */
  playMoveSound: (san: string) => void
  /** Plays the distinct "drill complete" chime, independent of any move's own cue. */
  playDrillCompleteSound: () => void
  /** Plays once whenever a legal move is rejected as outside the prepared line. */
  playWrongMoveSound: () => void
  /** Lichess API token, used only for the end-of-line review stats (see below) when signed out. */
  lichessToken: string
  /** Signed-in user, if any - drives both the review stats' backend routing and drill session recording. */
  user: AuthUser | null
  /** The signed-in user's server-side repertoire id for `color`, if known - see useDrillSessionRecording. */
  repertoireId: number | null
  /** All personal/global sources in a composed drill. Legacy callers may omit these. */
  repertoireIds?: number[]
  templateReleaseIds?: number[]
  /** Source-authored full lines, including provenance; graph leaves remain the fallback. */
  drillLines?: DrillLine[]
  /** Explorer occurrence used by "Drill from here". */
  startContext?: DrillStartContext
  /** Opens the completed line's final position in the main explorer. */
  onViewInExplorer: (historyUci: string[], finalFen: string) => void
}

const SELECTED_SQUARE_STYLE: CSSProperties = { backgroundColor: 'rgba(0, 0, 0, 0.2)' }
const LAST_MOVE_SQUARE_STYLE: CSSProperties = { backgroundColor: 'rgba(255, 235, 59, 0.5)' }
const LEGAL_TARGET_STYLE: CSSProperties = {
  backgroundImage: 'radial-gradient(circle, rgba(0, 0, 0, 0.2) 22%, transparent 24%)',
}
const CAPTURE_TARGET_STYLE: CSSProperties = {
  backgroundImage: 'radial-gradient(circle closest-side, rgba(0, 0, 0, 0.2) 0 calc(100% - 1px), transparent 100%)',
}
// Progressive wrong-attempt hints (2nd attempt: origin square, 3rd+: origin + destination).
const HINT_SQUARE_STYLE: CSSProperties = { boxShadow: 'inset 0 0 0 4px rgba(76, 175, 80, 0.65)' }
const WRONG_MOVE_SQUARE_STYLE: CSSProperties = { backgroundColor: 'rgba(239, 92, 92, 0.42)' }
// Distinct from the green save-hint squares above - this is a warning about an
// unprepped opponent try, not a hint about the user's own next move.
const BEST_RESPONSE_ARROW_COLOR = '#e0672a'
const EMPTY_SOURCE_IDS: number[] = []

/**
 * Drill mode: practices saved repertoire lines for `color`, isolated from the
 * explorer's own `useGame`/board state (see the Phase 3 plan's "Risks and
 * decisions" - drilling must never mutate the repertoire).
 */
export function DrillView({
  repertoire,
  color,
  onToggleColor,
  playMoveSound,
  playDrillCompleteSound,
  playWrongMoveSound,
  lichessToken,
  user,
  repertoireId,
  repertoireIds,
  templateReleaseIds = EMPTY_SOURCE_IDS,
  drillLines,
  startContext,
  onViewInExplorer,
}: Props) {
  const [startMode, setStartMode] = useState<DrillStartMode>(startContext ? 'selected_position' : 'beginning')
  const getContinuations = useCallback((fen: string) => repertoire.getContinuations(color, fen), [repertoire, color])
  const onStepApplied = useCallback((step: { san: string }) => playMoveSound(step.san), [playMoveSound])
  const recordingConfig = useMemo(() => {
    const ids = repertoireIds ?? (repertoireId === null ? [] : [repertoireId])
    if (ids.length === 0 && templateReleaseIds.length === 0) return null
    return {
      repertoireIds: ids,
      templateReleaseIds,
      isRetryPass: false,
      startMode,
      selectedFen: startContext?.selectedFen ?? null,
      selectedPly: startContext?.selectedPly ?? null,
      prefixUci: startContext?.prefixUci ?? [],
    }
  }, [repertoireIds, repertoireId, templateReleaseIds, startMode, startContext])
  const recording = useDrillSessionRecording(user !== null && recordingConfig !== null, recordingConfig)
  const session = useDrillSession({
    color,
    getContinuations,
    lines: drillLines,
    startMode,
    startContext,
    onStepApplied,
    onLineComplete: playDrillCompleteSound,
    recording,
  })
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null)

  const { state } = session
  const fen = state.currentFen
  const isOwnTurn = sideToMove(fen) === color
  const feedback = state.lastFeedback
  const isPaused = state.completionPause !== null
  const soundedWrongAttemptRef = useRef<number | null>(null)
  const completionActionRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (feedback?.kind !== 'wrong') {
      soundedWrongAttemptRef.current = null
      return
    }
    if (soundedWrongAttemptRef.current === feedback.attemptToken) return
    soundedWrongAttemptRef.current = feedback.attemptToken
    playWrongMoveSound()
  }, [feedback, playWrongMoveSound])

  useEffect(() => {
    if (!isPaused) return
    const revealAction = () => {
      const action = completionActionRef.current
      if (!action) return
      const bounds = action.getBoundingClientRect()
      if (bounds.top >= 0 && bounds.bottom <= window.innerHeight) return
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      action.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' })
    }
    const frame = requestAnimationFrame(revealAction)
    // Re-check after react-chessboard's final move animation settles; its
    // changing board geometry could otherwise interrupt the first scroll.
    const settled = window.setTimeout(revealAction, 350)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(settled)
    }
  }, [isPaused, state.completionPause?.lineId])

  // Fetch empirical outcomes only after a rejected move. Doing this during
  // normal play would reveal popular continuations and undermine the drill.
  const wrongStatsFen = useMemo(
    () => feedback?.kind === 'wrong' ? denormalizeFen(feedback.originFen, feedback.originPly) : '',
    [feedback],
  )
  const wrongMoveExplorer = useExplorerStats(
    wrongStatsFen,
    lichessToken,
    feedback?.kind === 'wrong',
    user !== null,
  )

  // Real-world stats for the position a completed line ends in, fetched only
  // while paused there: during the drill itself they'd both spoil the prepared
  // move and cost an API call for every position walked through.
  const reviewFen = session.completionFen
  const reviewExplorer = useExplorerStats(reviewFen ?? '', lichessToken, isPaused, user !== null)
  const reviewFollowups = useDrillFollowupStats(
    reviewFen ?? '',
    reviewExplorer.data,
    lichessToken,
    user !== null,
    isPaused,
  )
  const isReviewMoveSaved = useCallback(
    (uci: string) => (reviewFen ? repertoire.isMoveInActiveProfile(color, reviewFen, uci) : false),
    [repertoire, color, reviewFen],
  )
  const viewCompletionInExplorer = useCallback(() => {
    const completedLineId = state.completionPause?.lineId
    const completedLine = completedLineId ? state.linesById.get(completedLineId) : undefined
    if (!reviewFen || !completedLine) return
    onViewInExplorer(completedDrillHistoryUci(completedLine, startMode, startContext), reviewFen)
  }, [onViewInExplorer, reviewFen, startContext, startMode, state.completionPause, state.linesById])

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
    const lastAppliedStep = state.lastAppliedSteps.at(-1)
    if (lastAppliedStep?.resultingFen === fen) {
      styles[lastAppliedStep.uci.slice(0, 2)] = LAST_MOVE_SQUARE_STYLE
      styles[lastAppliedStep.uci.slice(2, 4)] = LAST_MOVE_SQUARE_STYLE
    }
    if (selectedSquare) {
      styles[selectedSquare] = { ...styles[selectedSquare], ...SELECTED_SQUARE_STYLE }
      for (const move of legalMoves) {
        styles[move.to] = { ...styles[move.to], ...(move.isCapture() ? CAPTURE_TARGET_STYLE : LEGAL_TARGET_STYLE) }
      }
    }
    if (feedback?.kind === 'wrong') {
      const wrongFrom = feedback.playedUci.slice(0, 2)
      const wrongTo = feedback.playedUci.slice(2, 4)
      styles[wrongFrom] = { ...styles[wrongFrom], ...WRONG_MOVE_SQUARE_STYLE }
      styles[wrongTo] = { ...styles[wrongTo], ...WRONG_MOVE_SQUARE_STYLE }
      if (feedback.hintFrom) styles[feedback.hintFrom] = { ...styles[feedback.hintFrom], ...HINT_SQUARE_STYLE }
      if (feedback.hintTo) styles[feedback.hintTo] = { ...styles[feedback.hintTo], ...HINT_SQUARE_STYLE }
    }
    return styles
  }, [selectedSquare, legalMoves, feedback, state.lastAppliedSteps, fen])

  // Drawn only while paused after completing a line. Orange is Stockfish's best
  // continuation; blue arrows are frequent moves from the Lichess sample. The
  // latter are empirical alternatives, not claimed strategic "themes".
  const arrows = useMemo<Arrow[]>(() => {
    const bestMoveUci = isPaused ? (session.completionEval?.bestMoveUci ?? null) : null
    if (!isPaused) return []
    const result: Arrow[] = []
    if (bestMoveUci) {
      const arrowUci = canonicalArrowUci(bestMoveUci)
      result.push({
        startSquare: arrowUci.slice(0, 2),
        endSquare: arrowUci.slice(2, 4),
        color: BEST_RESPONSE_ARROW_COLOR,
      })
    }
    for (const move of commonContinuations(reviewExplorer.data, bestMoveUci)) {
      const arrowUci = canonicalArrowUci(move.uci)
      result.push({
        startSquare: arrowUci.slice(0, 2),
        endSquare: arrowUci.slice(2, 4),
        color: continuationArrowColor(move.percentage),
      })
    }
    for (const move of commonContinuations(reviewFollowups.data, null)) {
      const arrowUci = canonicalArrowUci(move.uci)
      result.push({
        startSquare: arrowUci.slice(0, 2),
        endSquare: arrowUci.slice(2, 4),
        color: playerContinuationArrowColor(move.percentage),
      })
    }
    return result
  }, [isPaused, reviewExplorer.data, reviewFollowups.data, session.completionEval])

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
    // Dragging starts a separate move interaction from tap-to-move. Always
    // discard an earlier selected square, including after a rejected drop.
    setSelectedSquare(null)
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
          {startContext
            ? `No saved ${color} lines continue through this selected position.`
            : `No saved ${color} repertoire yet. Save some moves in the explorer first, then come back to drill them.`}
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
        <div className="board-with-eval">
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
          {/* Only shown once a line is finished - a live eval bar mid-drill would
              give away whether the move just played was the prepared one. The
              placeholder reserves the same width, so the board doesn't resize
              when the review pause starts and ends. */}
          {isPaused ? (
            <EvalBar evaluation={session.completionEval} boardColor={color} />
          ) : (
            <div className="eval-bar-placeholder" aria-hidden="true" />
          )}
        </div>
        <div className="board-controls">
          {startContext ? (
            <fieldset className="drill-start-mode">
              <legend>Drill from selected position</legend>
              <label>
                <input
                  type="radio"
                  name="drill-start-mode"
                  value="selected_position"
                  checked={startMode === 'selected_position'}
                  onChange={() => setStartMode('selected_position')}
                />
                Start at this position
              </label>
              <label>
                <input
                  type="radio"
                  name="drill-start-mode"
                  value="beginning"
                  checked={startMode === 'beginning'}
                  onChange={() => setStartMode('beginning')}
                />
                Start from move 1
              </label>
            </fieldset>
          ) : null}
          <button type="button" onClick={session.startNewSession}>
            Restart session
          </button>
        </div>
      </div>
      <div className="side-column">
        {isPaused ? (
          <div className="drill-review">
            <DrillLineCompletePanel
              evaluation={session.completionEval}
              explorerData={reviewExplorer.data}
              playerFollowupData={reviewFollowups.data}
              playerFollowupAfterSans={reviewFollowups.afterSans}
              leafPly={state.completionPause?.leafPly ?? 0}
              isLastDrill={session.complete}
              onNext={session.acknowledgeCompletion}
              onViewInExplorer={viewCompletionInExplorer}
              primaryActionRef={completionActionRef}
            />
            <section className="panel explorer-panel">
              <h2>Lichess explorer</h2>
              <ExplorerStatsTable
                data={reviewExplorer.data}
                loading={reviewExplorer.loading}
                error={reviewExplorer.error}
                isMoveSaved={isReviewMoveSaved}
                isMyMove={reviewFen ? sideToMove(reviewFen) === color : false}
              />
            </section>
          </div>
        ) : session.complete ? (
          <DrillSummary
            progress={session.progress}
            onRetryFailed={session.retryFailed}
            onNewSession={session.startNewSession}
          />
        ) : (
          <div className="panel drill-feedback-panel">
            <DrillFeedbackPanel
              feedback={feedback}
              similarPosition={session.similarPosition}
              color={color}
              lichessData={wrongMoveExplorer.data}
              lichessLoading={wrongMoveExplorer.loading}
            />
          </div>
        )}
      </div>
    </div>
  )
}
