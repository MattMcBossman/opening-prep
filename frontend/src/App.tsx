import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Chessboard } from 'react-chessboard'
import type { PieceDropHandlerArgs, SquareHandlerArgs } from 'react-chessboard'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import { useGame, START_FEN } from './hooks/useGame'
import type { MoveInput } from './hooks/useGame'
import { useAuth } from './hooks/useAuth'
import { useExplorerStats } from './hooks/useExplorerStats'
import { useEngineEval } from './hooks/useEngineEval'
import { useLichessToken } from './hooks/useLichessToken'
import { useTheme } from './hooks/useTheme'
import { useBoardColor } from './hooks/useBoardColor'
import { useHistoryKeyboardNav } from './hooks/useHistoryKeyboardNav'
import type { ExplorerSource } from './hooks/useExplorerStats'
import { useRepertoire } from './hooks/useRepertoire'
import type { LichessDatabaseFilters } from './lib/lichessExplorer'
import { useSound } from './hooks/useSound'
import { installAudioUnlock } from './audio/soundPlayer'
import { MoveList } from './components/MoveList'
import { ExplorerStatsTable } from './components/ExplorerStatsTable'
import { EngineEvalPanel } from './components/EngineEvalPanel'
import { EvalBar } from './components/EvalBar'
import { OpeningName } from './components/OpeningName'
import { LichessTokenSettings } from './components/LichessTokenSettings'
import { AuthControl } from './components/AuthControl'
import { ImportRepertoirePrompt } from './components/ImportRepertoirePrompt'
import { ThemeToggle } from './components/ThemeToggle'
import { SoundToggle } from './components/SoundToggle'
import { PgnImportExportPanel } from './components/PgnImportExportPanel'
import { RepertoireProfileControls } from './components/RepertoireProfileControls'
import { ExplorerSourceToggle } from './components/ExplorerSourceToggle'
import { ExplorerFiltersPanel } from './components/ExplorerFiltersPanel'
import { CoverageDashboard } from './components/CoverageDashboard'
import { BoardColorToggle } from './components/BoardColorToggle'
import { ModeToggle } from './components/ModeToggle'
import type { AppMode } from './components/ModeToggle'
import { DrillView } from './components/DrillView'
import { normalizeFen, originFenForPly, sideToMove } from './lib/chessUtils'
import { createDrillStartContext } from './lib/repertoireDrills'
import type { DrillStartContext } from './lib/repertoireDrills'
import { calculatePositionCoverage } from './lib/repertoireCoverage'
import type { ExplorerOpening, RepertoireMove } from './types'
import './App.css'

const SELECTED_SQUARE_STYLE: CSSProperties = { backgroundColor: 'rgba(255, 235, 59, 0.5)' }
// Quiet moves get a small center dot.
const LEGAL_TARGET_STYLE: CSSProperties = {
  backgroundImage: 'radial-gradient(circle, rgba(0, 0, 0, 0.3) 22%, transparent 24%)',
}
// Captures (and en passant) target an occupied square, where a center dot would be
// hidden behind the piece artwork, so use an inset ring around the square instead.
// A single alpha doesn't read the same on both square colors: on a dark square a
// translucent black ring sits against an already-dark background and only needs to be
// slightly deeper to stand out, while on a light square the same alpha washes out to a
// pale grey, so light squares get a noticeably darker ring.
const CAPTURE_TARGET_STYLE_DARK_SQUARE: CSSProperties = {
  boxShadow: 'inset 0 0 0 4px rgba(0, 0, 0, 0.35)',
}
const CAPTURE_TARGET_STYLE_LIGHT_SQUARE: CSSProperties = {
  boxShadow: 'inset 0 0 0 4px rgba(0, 0, 0, 0.6)',
}

/** Whether an algebraic square (e.g. "e4") is one of the board's light squares. */
function isLightSquare(square: string): boolean {
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0)
  const rank = square.charCodeAt(1) - '1'.charCodeAt(0)
  return (file + rank) % 2 === 1
}

function App() {
  const { fen, moves, pointer, goTo, goBack, goForward, makeMove, reset, loadLine, loadPosition } = useGame()
  const { theme, toggleTheme } = useTheme()
  const { boardColor, toggleBoardColor } = useBoardColor()
  const { token, setToken } = useLichessToken()
  const auth = useAuth()
  const isSignedIn = auth.user !== null
  const [explorerSource, setExplorerSource] = useState<ExplorerSource>('lichess')
  // Signed-out users have no "my games" source at all - always show the public database.
  const effectiveExplorerSource = isSignedIn ? explorerSource : 'lichess'
  // Each source owns its filters independently: switching tabs restores that
  // source's dates/game types instead of silently applying the other source's
  // selection. Rating bands exist only in the public-source entry.
  const [explorerFiltersBySource, setExplorerFiltersBySource] = useState<Record<ExplorerSource, LichessDatabaseFilters>>({
    lichess: {},
    'my-games': {},
  })
  const explorerFilters = explorerFiltersBySource[effectiveExplorerSource]
  const setExplorerFilters = useCallback((filters: LichessDatabaseFilters) => {
    setExplorerFiltersBySource((previous) => ({ ...previous, [effectiveExplorerSource]: filters }))
  }, [effectiveExplorerSource])
  const explorer = useExplorerStats(
    fen,
    token,
    true,
    isSignedIn,
    effectiveExplorerSource,
    boardColor,
    explorerFilters,
  )
  const evaluation = useEngineEval(fen)
  const repertoire = useRepertoire(auth.user)
  const { soundEnabled, toggleSound, playMoveSound, playDrillCompleteSound } = useSound()
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null)
  const [mode, setMode] = useState<AppMode>('explorer')
  const [drillStartContext, setDrillStartContext] = useState<DrillStartContext>()
  const [drillMounted, setDrillMounted] = useState(false)

  const handleModeChange = useCallback((nextMode: AppMode) => {
    // Mount lazily on the first visit, then keep the drill alive while Explorer
    // is visible so switching back resumes the same session. Restarting is an
    // explicit action inside DrillView.
    if (nextMode === 'drill' && !drillMounted) {
      setDrillStartContext(undefined)
      setDrillMounted(true)
    }
    setMode(nextMode)
  }, [drillMounted])

  const startDrillFromPosition = useCallback(() => {
    setDrillStartContext(createDrillStartContext(fen, pointer, moves))
    setDrillMounted(true)
    setMode('drill')
  }, [fen, moves, pointer])

  const viewDrillCompletionInExplorer = useCallback((historyUci: string[], finalFen: string) => {
    // Prefer the authored occurrence so Back/Forward and the move list remain
    // useful. A selected-position drill launched without a known prefix cannot
    // always be replayed from move one, so fall back to its exact final FEN.
    if (!loadLine(historyUci)) loadPosition(finalFen)
    setMode('explorer')
  }, [loadLine, loadPosition])

  // Primes the shared AudioContext on the page's first interaction, whatever it is -
  // see installAudioUnlock's docstring for why a move-triggered resume alone isn't
  // always enough (drilling Black can auto-play its first sound from a timer, before
  // the user has made a move of their own to resume the context from).
  useEffect(() => {
    installAudioUnlock()
  }, [])

  // ←/→ step through the current line, mirroring the Back/Forward buttons below the
  // board. Only in the explorer - the drill view has no move history to navigate.
  useHistoryKeyboardNav(goBack, goForward, mode === 'explorer')

  // Single entry point for playing a move in the explorer, so every route into the
  // board - drag, click-to-move, an explorer row, a saved continuation - sounds the
  // move without each call site having to remember to.
  const playMove = useCallback(
    (move: MoveInput): boolean => {
      const entry = makeMove(move)
      if (entry) playMoveSound(entry.san)
      return entry !== null
    },
    [makeMove, playMoveSound],
  )

  const isPlySaved = useCallback(
    (index: number) => {
      const entry = moves[index]
      if (!entry) return false
      return repertoire.isMoveSaved(boardColor, originFenForPly(moves, index), entry.uci)
    },
    [moves, boardColor, repertoire],
  )

  const onTogglePlySaved = useCallback(
    (index: number) => {
      const entry = moves[index]
      if (!entry) return
      const originFen = originFenForPly(moves, index)
      if (repertoire.isMoveSaved(boardColor, originFen, entry.uci)) {
        repertoire.removeMove(boardColor, originFen, entry.uci)
        return
      }
      // Saving a move also saves every earlier unsaved ply in this line - both the
      // owner's own moves and the opponent's replies along the way, so the whole path
      // from the start becomes reachable via saved continuations, not just this one
      // deep branch. The opponent's plies aren't independently toggleable (see
      // MoveList), but they're what let a continuation say "here's my response to
      // this specific opponent move."
      const steps = moves.slice(0, index + 1).map((ancestor, ply) => ({
        originFen: originFenForPly(moves, ply),
        san: ancestor.san,
        uci: ancestor.uci,
        resultingFen: normalizeFen(ancestor.fenAfter),
      }))
      repertoire.addLine(boardColor, steps)
    },
    [moves, boardColor, repertoire],
  )

  const handleToggleBoardColor = useCallback(() => {
    toggleBoardColor()
    reset()
  }, [toggleBoardColor, reset])

  const continuations = useMemo(
    () => repertoire.getContinuations(boardColor, fen),
    [repertoire, boardColor, fen],
  )
  const getRepertoireContinuations = repertoire.getContinuations
  const coverageContinuations = useCallback(
    (positionFen: string) => getRepertoireContinuations(boardColor, positionFen),
    [boardColor, getRepertoireContinuations],
  )

  const playRepertoireMove = useCallback((move: RepertoireMove) => playMove(move.san), [playMove])
  const removeRepertoireMove = useCallback(
    (move: RepertoireMove) => repertoire.removeMove(boardColor, fen, move.uci),
    [repertoire, boardColor, fen],
  )
  const isContinuationEditable = useCallback(
    (move: RepertoireMove) => repertoire.isMoveSaved(boardColor, fen, move.uci),
    [repertoire, boardColor, fen],
  )

  const isExplorerMoveSaved = useCallback(
    (uci: string) => repertoire.isMoveInActiveProfile(boardColor, fen, uci),
    [repertoire, boardColor, fen],
  )

  const handleProfileChange = useCallback(
    (profileId: number) => {
      repertoire.setActiveProfile(profileId)
      reset()
    },
    [repertoire, reset],
  )

  // The explorer always lists candidate moves for whoever is to move at the current
  // position, so this is either "my" turn or the opponent's for every row at once -
  // used to pick the saved-move badge glyph (star for mine, checkmark for theirs).
  const isExplorerMyMove = sideToMove(fen) === boardColor
  const positionCoverage = useMemo(() => {
    if (!explorer.data || isExplorerMyMove) return null
    return calculatePositionCoverage(
      explorer.data.moves,
      repertoire.getContinuations(boardColor, fen),
      (replyFen) => repertoire.getContinuations(boardColor, replyFen),
    )
  }, [boardColor, explorer.data, fen, isExplorerMyMove, repertoire])

  // Remembers the opening name/ECO fetched for every FEN visited along the current
  // line, so a position with no name of its own can fall back to the last known name
  // for the line rather than showing "Unnamed position".
  const openingNameCache = useRef(new Map<string, ExplorerOpening>()).current
  useEffect(() => {
    if (explorer.data) {
      openingNameCache.set(fen, explorer.data.opening)
    }
  }, [fen, explorer.data, openingNameCache])

  const resolvedOpening = useMemo<ExplorerOpening>(() => {
    const live = explorer.data?.opening ?? null
    if (live) return live
    for (let ply = pointer - 1; ply >= 0; ply--) {
      const ancestorFen = ply === 0 ? START_FEN : moves[ply - 1].fenAfter
      const cached = openingNameCache.get(ancestorFen)
      if (cached) return cached
    }
    return null
  }, [explorer.data, pointer, moves, openingNameCache])

  // Any position change (drag move, click-to-move, explorer click, history navigation,
  // reset) invalidates the current selection.
  useEffect(() => {
    setSelectedSquare(null)
  }, [fen])

  const legalMoves = useMemo(() => {
    if (!selectedSquare) return []
    try {
      return new Chess(fen).moves({ square: selectedSquare as Square, verbose: true })
    } catch {
      return []
    }
  }, [fen, selectedSquare])

  const squareStyles = useMemo(() => {
    if (!selectedSquare) return undefined
    const styles: Record<string, CSSProperties> = { [selectedSquare]: SELECTED_SQUARE_STYLE }
    for (const move of legalMoves) {
      styles[move.to] = {
        ...styles[move.to],
        ...(move.isCapture()
          ? isLightSquare(move.to)
            ? CAPTURE_TARGET_STYLE_LIGHT_SQUARE
            : CAPTURE_TARGET_STYLE_DARK_SQUARE
          : LEGAL_TARGET_STYLE),
      }
    }
    return styles
  }, [selectedSquare, legalMoves])

  function handlePieceDrop({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean {
    if (!targetSquare) return false
    return playMove({ from: sourceSquare, to: targetSquare, promotion: 'q' })
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
    const moved = playMove({ from: selectedSquare, to: square, promotion: 'q' })
    if (!moved) {
      // Illegal target: if the clicked square holds a piece, select it instead of
      // just clearing the selection outright.
      setSelectedSquare(piece ? square : null)
    }
  }

  return (
    <div className="app-layout">
      <header className="app-header">
        <h1>opening-prep</h1>
        <p>Opening explorer &amp; repertoire builder</p>
        <ModeToggle mode={mode} onChange={handleModeChange} />
        <RepertoireProfileControls
            profiles={repertoire.profiles}
            modules={repertoire.modules}
            activeProfileId={repertoire.activeProfileId}
            editingModuleId={repertoire.editingModuleIds[boardColor] ?? null}
            editingLinePaths={repertoire.editingLinePaths[boardColor] ?? []}
            color={boardColor}
            disabled={repertoire.isSyncing}
            showGlobalLibrary={isSignedIn}
            onProfileChange={handleProfileChange}
            onEditingModuleChange={(moduleId) => repertoire.setEditingModule(boardColor, moduleId)}
            onCreateProfile={repertoire.createProfile}
            onRenameProfile={repertoire.renameProfile}
            onDeleteProfile={repertoire.deleteProfile}
            onCreateModule={repertoire.createModule}
            onRenameModule={repertoire.renameModule}
            onDeleteModule={repertoire.deleteModule}
            onSetMembership={repertoire.setModuleMembership}
            onRemoveMembership={repertoire.removeModuleMembership}
            onPinTemplate={repertoire.pinTemplate}
            onUnpinTemplate={repertoire.unpinTemplate}
            onCopyTemplate={repertoire.copyTemplate}
            onCopyMissingTemplateLines={repertoire.copyMissingTemplateLines}
            onPreviewTemplate={repertoire.setPreviewRelease}
          />
        <div className="header-controls">
          <SoundToggle soundEnabled={soundEnabled} onToggle={toggleSound} />
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <AuthControl user={auth.user} loading={auth.loading} onLogin={() => auth.login()} onLogout={auth.logout} />
        </div>
      </header>
      {auth.authError && (
        <p className="panel-status error auth-error-banner">
          {auth.authError}{' '}
          <button type="button" onClick={auth.dismissAuthError}>
            Dismiss
          </button>
        </p>
      )}
      {repertoire.syncError && (
        <p className="panel-status error auth-error-banner">
          {repertoire.syncErrorKind === 'load' ? 'Repertoire could not be loaded' : 'Repertoire change failed'}: {repertoire.syncError}{' '}
          <button type="button" onClick={repertoire.clearSyncError}>Dismiss</button>
        </p>
      )}
      <ImportRepertoirePrompt
        phase={repertoire.importPrompt.phase}
        counts={repertoire.importPrompt.counts}
        onConfirm={repertoire.importPrompt.confirm}
        onDismiss={repertoire.importPrompt.dismiss}
        onClose={repertoire.importPrompt.close}
      />
      {drillMounted && (
        <div hidden={mode !== 'drill'}>
          <DrillView
            repertoire={repertoire}
            color={boardColor}
            onToggleColor={handleToggleBoardColor}
            playMoveSound={playMoveSound}
            playDrillCompleteSound={playDrillCompleteSound}
            lichessToken={token}
            user={auth.user}
            repertoireId={repertoire.repertoireIds[boardColor] ?? null}
            repertoireIds={repertoire.activeProfile?.modules
              .filter((module) => module.enabled && module.color === boardColor)
              .map((module) => module.id)}
            templateReleaseIds={repertoire.activeProfile?.templateReleases
              ?.filter((release) => release.enabled && release.color === boardColor)
              .map((release) => release.id)}
            drillLines={repertoire.drillLines[boardColor]}
            startContext={drillStartContext}
            onViewInExplorer={viewDrillCompletionInExplorer}
          />
        </div>
      )}
      {mode === 'explorer' && (
        <main className="explorer-layout">
          <section className="panel moves-panel">
            <h2>Moves</h2>
            <MoveList
              moves={moves}
              pointer={pointer}
              onSelect={goTo}
              boardColor={boardColor}
              isPlySaved={isPlySaved}
              onTogglePlySaved={onTogglePlySaved}
              continuations={continuations}
              onPlayContinuation={playRepertoireMove}
              onRemoveContinuation={removeRepertoireMove}
              isContinuationEditable={isContinuationEditable}
            />
          </section>

          <div className="board-column">
            <div className="board-heading">
              <OpeningName eco={resolvedOpening?.eco ?? null} name={resolvedOpening?.name ?? null} fen={fen} />
              <BoardColorToggle boardColor={boardColor} onToggle={handleToggleBoardColor} />
            </div>
            <div className="board-with-eval">
              <div className="board-wrapper">
                <Chessboard
                  options={{
                    position: fen,
                    boardOrientation: boardColor,
                    onPieceDrop: handlePieceDrop,
                    onSquareClick: handleSquareClick,
                    squareStyles,
                    showAnimations: true,
                    animationDurationInMs: 300,
                    id: 'opening-prep-explorer-board',
                  }}
                />
              </div>
              <EvalBar evaluation={evaluation} boardColor={boardColor} />
            </div>
            <div className="board-controls">
              <button type="button" onClick={goBack} disabled={pointer === 0} title="Back (left arrow key)">
                ← Back
              </button>
              <button
                type="button"
                onClick={goForward}
                disabled={pointer === moves.length}
                title="Forward (right arrow key)"
              >
                Forward →
              </button>
              <button type="button" onClick={reset} disabled={moves.length === 0 && fen === START_FEN}>
                Reset
              </button>
              <button type="button" onClick={startDrillFromPosition} disabled={pointer === 0}>
                Drill from here
              </button>
            </div>
            <EngineEvalPanel evaluation={evaluation} />
          </div>

          <div className="side-column">
            <section className="panel explorer-panel">
              <h2>Lichess explorer</h2>
              {isSignedIn && <ExplorerSourceToggle source={explorerSource} onChange={setExplorerSource} />}
              {!isSignedIn && <LichessTokenSettings token={token} onChange={setToken} />}
              <ExplorerFiltersPanel
                source={effectiveExplorerSource}
                filters={explorerFilters}
                onChange={setExplorerFilters}
              />
              <ExplorerStatsTable
                data={explorer.data}
                loading={explorer.loading}
                error={explorer.error}
                onMoveClick={(san) => playMove(san)}
                isMoveSaved={isExplorerMoveSaved}
                isMyMove={isExplorerMyMove}
                isPolling={explorer.isPolling}
                pollExhausted={explorer.pollExhausted}
                pollStalled={explorer.pollStalled}
                onRetry={explorer.retry}
              />
              {positionCoverage && positionCoverage.totalGames > 0 && (
                <p className="panel-status">
                  Prepared-response coverage: <strong>{positionCoverage.percent.toFixed(1)}%</strong>{' '}
                  ({positionCoverage.coveredMoves}/{positionCoverage.totalMoves} replies, weighted by games)
                </p>
              )}
            </section>
            <section className="panel">
              <CoverageDashboard
                color={boardColor}
                tree={repertoire.getTree(boardColor)}
                apiToken={token}
                signedIn={isSignedIn}
                filters={explorerFiltersBySource.lichess}
                getContinuations={coverageContinuations}
              />
            </section>
            <section className="panel">
              <h2>PGN</h2>
              <PgnImportExportPanel
                color={boardColor}
                getTree={repertoire.getTree}
                getLines={(color) => repertoire.editingLines[color] ?? []}
                isMoveSaved={repertoire.isMoveSaved}
                addLine={repertoire.addLine}
              />
            </section>
          </div>
        </main>
      )}
    </div>
  )
}

export default App
