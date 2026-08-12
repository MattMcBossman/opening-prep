import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Chessboard } from 'react-chessboard'
import type { Arrow, PieceDataType, PieceDropHandlerArgs, SquareHandlerArgs } from 'react-chessboard'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import { useDrillSession } from '../hooks/useDrillSession'
import { useDrillSessionRecording } from '../hooks/useDrillSessionRecording'
import { useExplorerStats } from '../hooks/useExplorerStats'
import { useEngineComparison } from '../hooks/useEngineComparison'
import type { MoveComparisonResult } from '../hooks/useEngineComparison'
import { usePositionAnalysis } from '../hooks/usePositionAnalysis'
import { usePositionFeatures } from '../hooks/usePositionFeatures'
import { useMoveFeatureComparison } from '../hooks/useMoveFeatureComparison'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useResetKeyboardShortcut } from '../hooks/useResetKeyboardShortcut'
import { useRepertoire } from '../hooks/useRepertoire'
import { denormalizeFen, sideToMove } from '../lib/chessUtils'
import { completedDrillHistoryUci } from '../lib/repertoireDrills'
import { pendingAutoPlayStep } from '../lib/drillSessionLogic'
import { analysisArrowMoves } from '../lib/positionAnalysis'
import { canonicalArrowUci, playerContinuationArrowColor } from '../lib/drillPositionAssessment'
import type { DrillLine, DrillStartContext, DrillStartMode } from '../lib/repertoireDrills'
import type { AuthUser } from '../lib/authApi'
import type { PositionAnalysis, PositionFact, RepertoireColor } from '../types'
import { DrillFeedbackPanel } from './DrillFeedbackPanel'
import { DrillLineCompletePanel } from './DrillLineCompletePanel'
import { DrillSummary } from './DrillSummary'
import { BoardColorToggle } from './BoardColorToggle'
import { EvalBar } from './EvalBar'
import { ExplorerStatsTable } from './ExplorerStatsTable'

type Props = {
  /** False while Explorer is visible; keeps session state mounted without asking
   * react-chessboard to animate inside a display:none ancestor. */
  active: boolean
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
  startMode: DrillStartMode
  /** Opens the completed line's final position in the main explorer. */
  onViewInExplorer: (historyUci: string[], finalFen: string) => void
  onResetStartPosition: () => void
}

const SELECTED_SQUARE_STYLE: CSSProperties = { backgroundColor: 'rgba(0, 0, 0, 0.2)' }
const DROP_SQUARE_STYLE: CSSProperties = { boxShadow: 'none' }
const LAST_MOVE_SQUARE_STYLE: CSSProperties = { backgroundColor: 'rgba(255, 235, 59, 0.5)' }
const LEGAL_TARGET_STYLE: CSSProperties = {
  backgroundImage: 'radial-gradient(circle, rgba(0, 0, 0, 0.2) 22%, transparent 24%)',
}
const CAPTURE_TARGET_STYLE: CSSProperties = {
  backgroundImage: 'radial-gradient(circle closest-side, rgba(0, 0, 0, 0.2) 0 calc(100% - 1px), transparent 100%)',
}
// Progressive wrong-attempt hints (2nd attempt: origin square, 3rd+: origin + destination).
const HINT_SQUARE_STYLE: CSSProperties = { backgroundColor: 'rgba(76, 175, 80, 0.58)' }
const WRONG_MOVE_SQUARE_STYLE: CSSProperties = { backgroundColor: 'rgba(239, 92, 92, 0.42)' }
const FACT_EVIDENCE_SQUARE_STYLE: CSSProperties = {
  boxShadow: 'inset 0 0 0 5px rgba(155, 113, 255, 0.82)',
}

function pieceMatchesColor(piece: PieceDataType | null, color: RepertoireColor): boolean {
  return piece?.pieceType.startsWith(color === 'white' ? 'w' : 'b') ?? false
}
// Distinct from the green save-hint squares above - this is a warning about an
// unprepped opponent try, not a hint about the user's own next move.
const BEST_RESPONSE_ARROW_COLOR = '#e0672a'
const OPPONENT_CONTINUATION_ARROW_COLOR = '#4d86d8'
const EMPTY_SOURCE_IDS: number[] = []
const WRONG_MOVE_HOLD_MS = 1_000
const ARROW_DEPTH_MILESTONES = [8, 16, 24] as const

function arrowDepthMilestone(depth: number): number {
  return [...ARROW_DEPTH_MILESTONES].reverse().find((milestone) => depth >= milestone) ?? 0
}

/**
 * Drill mode: practices saved repertoire lines for `color`, isolated from the
 * explorer's own `useGame`/board state (see the Phase 3 plan's "Risks and
 * decisions" - drilling must never mutate the repertoire).
 */
export function DrillView({
  active,
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
  startMode,
  onViewInExplorer,
  onResetStartPosition,
}: Props) {
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
    signedIn: user !== null,
  })
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null)
  const [hoveredSquare, setHoveredSquare] = useState<string | null>(null)
  const [wrongMovePreview, setWrongMovePreview] = useState<{ fen: string; key: number } | null>(null)

  const { state } = session
  const fen = state.currentFen
  const boardFen = wrongMovePreview?.fen ?? fen
  const isOwnTurn = sideToMove(fen) === color
  const feedback = state.lastFeedback
  const isPaused = state.completionPause !== null
  const boardInputEnabled = isOwnTurn && !session.complete && !isPaused && !wrongMovePreview
  const isDesktopReview = useMediaQuery('(min-width: 701px)')
  const soundedWrongAttemptRef = useRef<number | null>(null)
  const [reviewSection, setReviewSection] = useState<'analysis' | 'stats' | null>(null)
  const reviewPanelRef = useRef<HTMLDivElement>(null)
  const restartFromKeyboard = useCallback(() => {
    setSelectedSquare(null)
    setHoveredSquare(null)
    setWrongMovePreview(null)
    setReviewSection(null)
    session.startNewSession()
  }, [session])
  useResetKeyboardShortcut(restartFromKeyboard, active && state.lines.length > 0)

  useEffect(() => {
    setSelectedSquare(null)
    setHoveredSquare(null)
  }, [fen])

  const openReviewSection = useCallback((section: 'analysis' | 'stats') => {
    setReviewSection(section)
    requestAnimationFrame(() => {
      reviewPanelRef.current?.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      })
    })
  }, [])

  useEffect(() => {
    if (!wrongMovePreview) return
    const timeoutId = window.setTimeout(() => setWrongMovePreview(null), WRONG_MOVE_HOLD_MS)
    return () => window.clearTimeout(timeoutId)
  }, [wrongMovePreview])

  // A new drill scope/color can replace the session while a rejected position
  // is still being shown. Never carry that visual-only position into it.
  useEffect(() => setWrongMovePreview(null), [color, startContext])

  useEffect(() => {
    if (feedback?.kind !== 'wrong') {
      soundedWrongAttemptRef.current = null
      return
    }
    if (soundedWrongAttemptRef.current === feedback.attemptToken) return
    soundedWrongAttemptRef.current = feedback.attemptToken
    playWrongMoveSound()
  }, [feedback, playWrongMoveSound])

  useEffect(() => setReviewSection(null), [state.completionPause?.lineId])

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
  const reviewExplorer = useExplorerStats(
    reviewFen ?? '',
    lichessToken,
    isPaused && (isDesktopReview || reviewSection === 'stats'),
    user !== null,
  )
  const positionAnalysis = usePositionAnalysis(
    reviewFen ?? '',
    isPaused,
    user !== null,
  )
  const positionFeatures = usePositionFeatures(reviewFen ?? '', isPaused)
  const completionMove = state.playedSteps.at(-1)
  const moveComparison = useMoveFeatureComparison(
    completionMove?.fen ?? '',
    completionMove?.uci ?? '',
    isPaused,
  )
  const [selectedFact, setSelectedFact] = useState<PositionFact | null>(null)
  useEffect(() => setSelectedFact(null), [reviewFen])
  const [similarComparisonOpen, setSimilarComparisonOpen] = useState(false)
  const wrongAttemptToken = feedback?.kind === 'wrong' ? feedback.attemptToken : null
  useEffect(() => setSimilarComparisonOpen(false), [wrongAttemptToken])
  const { compare: compareCompletionMove } = useEngineComparison(user !== null)
  const [completionMoveQuality, setCompletionMoveQuality] = useState<MoveComparisonResult | null>(null)
  useEffect(() => {
    setCompletionMoveQuality(null)
    if (!isPaused || !reviewFen || !completionMove) return
    let cancelled = false
    void compareCompletionMove(
      completionMove.fen,
      reviewFen,
      sideToMove(completionMove.fen),
    ).then((result) => {
      if (!cancelled) setCompletionMoveQuality(result)
    }, () => undefined)
    return () => { cancelled = true }
  }, [compareCompletionMove, completionMove, isPaused, reviewFen])
  const currentPositionFeatures = positionFeatures.features?.fen === reviewFen
    ? positionFeatures.features
    : null
  const currentPositionAnalysis = positionAnalysis.analysis?.fen === reviewFen
    ? positionAnalysis.analysis
    : null
  const [arrowAnalysis, setArrowAnalysis] = useState<PositionAnalysis | null>(null)
  useEffect(() => setArrowAnalysis(null), [reviewFen])
  useEffect(() => {
    if (!currentPositionAnalysis || arrowDepthMilestone(currentPositionAnalysis.depth) === 0) return
    setArrowAnalysis((previous) => {
      if (!previous || previous.fen !== currentPositionAnalysis.fen) return currentPositionAnalysis
      return arrowDepthMilestone(currentPositionAnalysis.depth) > arrowDepthMilestone(previous.depth)
        ? currentPositionAnalysis
        : previous
    })
  }, [currentPositionAnalysis])
  const reviewEvaluation = useMemo(() => {
    const analysis = positionAnalysis.analysis
    const best = analysis?.candidates.find((candidate) => candidate.rank === 1) ?? analysis?.candidates[0]
    if (!analysis || !best) return null
    return {
      fen: analysis.fen,
      depth: best.depth,
      scoreType: best.scoreType,
      scoreValue: best.scoreValue,
      bestMoveUci: best.bestMoveUci,
      pvUci: best.pvUci,
      thinking: positionAnalysis.loading,
    }
  }, [positionAnalysis.analysis, positionAnalysis.loading])
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
      const hoveredTarget = hoveredSquare !== selectedSquare
        && legalMoves.some((move) => move.to === hoveredSquare)
        ? hoveredSquare
        : null
      for (const move of legalMoves) {
        if (move.to === hoveredTarget) continue
        styles[move.to] = { ...styles[move.to], ...(move.isCapture() ? CAPTURE_TARGET_STYLE : LEGAL_TARGET_STYLE) }
      }
      if (hoveredTarget) {
        styles[hoveredTarget] = { ...styles[hoveredTarget], ...SELECTED_SQUARE_STYLE }
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
    if (isPaused && selectedFact) {
      for (const square of selectedFact.squares) {
        styles[square] = { ...styles[square], ...FACT_EVIDENCE_SQUARE_STYLE }
      }
    }
    if (similarComparisonOpen && session.similarPosition) {
      for (const square of session.similarPosition.differingSquares) {
        styles[square] = { ...styles[square], ...FACT_EVIDENCE_SQUARE_STYLE }
      }
    }
    return styles
  }, [selectedSquare, hoveredSquare, legalMoves, feedback, state.lastAppliedSteps, fen, isPaused, selectedFact, session.similarPosition, similarComparisonOpen])

  // Drawn only while paused. Rank one remains visually distinct; every
  // opponent continuation uses one blue so the board does not imply separate
  // categories among replies. The player's later ideas retain frequency shading.
  const arrows = useMemo<Arrow[]>(() => {
    const analysis = arrowAnalysis?.fen === reviewFen ? arrowAnalysis : null
    if (!isPaused || !analysis) return []
    const result: Arrow[] = []
    for (const move of analysisArrowMoves(analysis, color)) {
      const arrowUci = canonicalArrowUci(move.uci)
      result.push({
        startSquare: arrowUci.slice(0, 2),
        endSquare: arrowUci.slice(2, 4),
        color: move.isBest
          ? BEST_RESPONSE_ARROW_COLOR
          : move.side !== color
            ? OPPONENT_CONTINUATION_ARROW_COLOR
            : playerContinuationArrowColor(move.frequency),
      })
    }
    return result
  }, [arrowAnalysis, color, isPaused, reviewFen])

  const tryMove = useCallback(
    (candidate: { from: string; to: string; promotion?: string }): boolean => {
      if (!isOwnTurn || session.complete || isPaused || wrongMovePreview) return false
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
      const isWrongMove = !accepted && !getContinuations(fen).some((move) => move.uci === uci)
      // Sounds (the move itself, its auto-played opponent reply, and the
      // drill-complete chime) are handled by useDrillSession's onStepApplied/
      // onLineComplete callbacks, timed to when each ply actually lands on the
      // board - see AUTO_PLAY_DELAY_MS.
      session.attemptMove({ uci, san: result.san, resultingFen: trial.fen() })
      if (isWrongMove) setWrongMovePreview({ fen: trial.fen(), key: Date.now() })
      // A genuine wrong move is rendered as a controlled temporary position,
      // so a drag must be allowed to land. It reverts after the hold above.
      return accepted || isWrongMove
    },
    [fen, getContinuations, isOwnTurn, session, isPaused, wrongMovePreview],
  )

  function handlePieceDrop({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean {
    // Dragging starts a separate move interaction from tap-to-move. Always
    // discard an earlier selected square, including after a rejected drop.
    setSelectedSquare(null)
    setHoveredSquare(null)
    if (!targetSquare) return false
    // Wrong moves remain unapplied to the drill session, but tryMove lets the
    // controlled preview position land briefly before restoring `fen`.
    return tryMove({ from: sourceSquare, to: targetSquare, promotion: 'q' })
  }

  function handleSquareClick({ square, piece }: SquareHandlerArgs) {
    if (!selectedSquare) {
      if (boardInputEnabled && pieceMatchesColor(piece, color)) setSelectedSquare(square)
      return
    }
    if (square === selectedSquare) {
      setSelectedSquare(null)
      return
    }
    const moved = tryMove({ from: selectedSquare, to: square, promotion: 'q' })
    setSelectedSquare(moved ? null : boardInputEnabled && pieceMatchesColor(piece, color) ? square : null)
  }

  if (state.lines.length === 0) {
    return (
      <div className="panel drill-empty">
        <p className="panel-status">
          {startContext
            ? `No saved ${color} lines continue through this selected position.`
            : `No saved ${color} repertoire yet. Save some moves in the explorer first, then come back to drill them.`}
        </p>
        {startContext && (
          <button type="button" className="drill-reset-start" onClick={onResetStartPosition}>
            Drill from initial position
          </button>
        )}
      </div>
    )
  }

  const progressLabel = session.progress.isRetryPass ? 'Retrying failed drill' : 'Drill'

  return (
    <div className="drill-layout">
      <div className="board-column">
        <div className="board-heading">
          <div className="drill-progress">
            {startContext && (
              <strong className="drill-start-position-name">
                {startContext.openingEco ? `${startContext.openingEco} · ` : ''}{startContext.openingName ?? 'Selected position'}
                {startContext.positionMoveLabel ? `, ${startContext.positionMoveLabel}` : ''}
              </strong>
            )}
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
          <div className="board-wrapper" data-active-piece-color={boardInputEnabled ? color : 'none'}>
            {active && (
              <div data-testid="drill-chessboard">
                <Chessboard
                  key={wrongMovePreview ? `wrong-${wrongMovePreview.key}` : 'drill-position'}
                  options={{
                    position: boardFen,
                    boardOrientation: color,
                    canDragPiece: ({ piece }) => (
                      boardInputEnabled
                      && pieceMatchesColor(piece, color)
                    ),
                    onPieceDrag: ({ square }) => {
                      setSelectedSquare(square)
                    },
                    onPieceDragCancel: () => {
                      setSelectedSquare(null)
                      setHoveredSquare(null)
                    },
                    onPieceDrop: handlePieceDrop,
                    onSquareClick: handleSquareClick,
                    onMouseOverSquare: ({ square }) => setHoveredSquare(square),
                    onMouseOutSquare: ({ square }) => setHoveredSquare((current) => current === square ? null : current),
                    squareStyles,
                    dropSquareStyle: DROP_SQUARE_STYLE,
                    arrows,
                    showAnimations: true,
                    animationDurationInMs: 300,
                    id: 'opening-prep-drill-board',
                  }}
                />
              </div>
            )}
          </div>
          {/* Only shown once a line is finished - a live eval bar mid-drill would
              give away whether the move just played was the prepared one. The
              placeholder reserves the same width, so the board doesn't resize
              when the review pause starts and ends. */}
          {isPaused ? (
            <EvalBar evaluation={reviewEvaluation} boardColor={color} />
          ) : (
            <div className="eval-bar-placeholder" aria-hidden="true" />
          )}
        </div>
        <div className="board-controls">
          {isPaused && (
            <div className="drill-review-actions">
              <button type="button" onClick={viewCompletionInExplorer}>View in explorer</button>
              <button type="button" onClick={session.acknowledgeCompletion}>
                {session.complete ? 'Finish' : 'Next drill'}
              </button>
              <button
                type="button"
                className="mobile-review-section-button"
                aria-expanded={reviewSection === 'analysis'}
                onClick={() => openReviewSection('analysis')}
              >
                Analysis
              </button>
              <button
                type="button"
                className="mobile-review-section-button"
                aria-expanded={reviewSection === 'stats'}
                onClick={() => openReviewSection('stats')}
              >
                Stats
              </button>
              <button type="button" onClick={session.startNewSession} title="Restart session (R)">Restart session</button>
              <button type="button" onClick={session.shuffleOrder} disabled={session.complete}>Shuffle drills</button>
            </div>
          )}
          {!isPaused && <>
            <button type="button" onClick={session.shuffleOrder} disabled={session.complete}>Shuffle drills</button>
            <button type="button" onClick={session.startNewSession} title="Restart session (R)">Restart session</button>
          </>}
        </div>
      </div>
      {(!isPaused || isDesktopReview || reviewSection !== null) && <div className="side-column">
        {isPaused ? (
          <div ref={reviewPanelRef} className="drill-review">
            {(isDesktopReview || reviewSection === 'analysis') && <DrillLineCompletePanel
                leafPly={state.completionPause?.leafPly ?? 0}
                positionAnalysis={currentPositionAnalysis}
                positionAnalysisLoading={positionAnalysis.loading}
                positionAnalysisError={positionAnalysis.error}
                positionFeatures={currentPositionFeatures}
                positionFeaturesLoading={positionFeatures.loading}
                positionFeaturesError={positionFeatures.error}
                moveComparison={moveComparison.comparison}
                moveComparisonLoading={moveComparison.loading}
                moveComparisonError={moveComparison.error}
                selectedFactId={selectedFact?.id ?? null}
                onSelectFact={setSelectedFact}
                completionMoveQuality={completionMoveQuality}
              />}
            {(isDesktopReview || reviewSection === 'stats') && <section className="panel explorer-panel">
              <h2>Lichess explorer</h2>
              <ExplorerStatsTable
                data={reviewExplorer.data}
                loading={reviewExplorer.loading}
                error={reviewExplorer.error}
                isMoveSaved={isReviewMoveSaved}
                isMyMove={reviewFen ? sideToMove(reviewFen) === color : false}
              />
            </section>}
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
              startMode={startMode}
              opponentMovePending={pendingAutoPlayStep(state) !== null}
              readyForNextMove={state.lastAppliedSteps.at(-1)?.mover === 'opponent'}
              lichessData={wrongMoveExplorer.data}
              lichessLoading={wrongMoveExplorer.loading}
              comparisonOpen={similarComparisonOpen}
              onComparisonOpenChange={setSimilarComparisonOpen}
            />
          </div>
        )}
      </div>}
    </div>
  )
}
