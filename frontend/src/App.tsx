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
import { AccountMergePrompt } from './components/AccountMergePrompt'
import { ThemeToggle } from './components/ThemeToggle'
import { SoundToggle } from './components/SoundToggle'
import { PgnImportExportPanel } from './components/PgnImportExportPanel'
import { OpeningGeneratorPanel } from './components/OpeningGeneratorPanel'
import { parsePgnLinesWithMetadata } from './lib/pgnImport'
import { RepertoireProfileControls } from './components/RepertoireProfileControls'
import { ExplorerSourceToggle } from './components/ExplorerSourceToggle'
import { ExplorerFiltersPanel } from './components/ExplorerFiltersPanel'
import { CoverageDashboard } from './components/CoverageDashboard'
import { BoardColorToggle } from './components/BoardColorToggle'
import { ModeToggle } from './components/ModeToggle'
import type { AppMode } from './components/ModeToggle'
import { DrillView } from './components/DrillView'
import { normalizeFen, originFenForPly, sideToMove } from './lib/chessUtils'
import { createDrillStartContext, migrateDrillStartContext, openingDisambiguationLabel } from './lib/repertoireDrills'
import type { DrillStartContext, DrillStartMode } from './lib/repertoireDrills'
import { calculatePositionCoverage } from './lib/repertoireCoverage'
import { findResponseConflicts } from './lib/repertoireTree'
import type { ExplorerOpening, RepertoireMove } from './types'
import { lichessLoginUrl } from './lib/authApi'
import './App.css'

const SELECTED_SQUARE_STYLE: CSSProperties = { backgroundColor: 'rgba(0, 0, 0, 0.2)' }
const LAST_MOVE_SQUARE_STYLE: CSSProperties = { backgroundColor: 'rgba(255, 235, 59, 0.5)' }
// Quiet moves get a small center dot.
const LEGAL_TARGET_STYLE: CSSProperties = {
  backgroundImage: 'radial-gradient(circle, rgba(0, 0, 0, 0.2) 22%, transparent 24%)',
}
// Captures use a large circular outline around the destination piece. Keeping
// the center transparent leaves the piece artwork unobscured, while the thick
// outer ring remains visible on both light and dark board squares.
const CAPTURE_TARGET_STYLE: CSSProperties = {
  backgroundImage: 'radial-gradient(circle closest-side, rgba(0, 0, 0, 0.2) 0 calc(100% - 1px), transparent 100%)',
}

const VIEW_SESSION_KEY = 'opening-prep:view-session:v1'
type ViewSession = {
  mode: AppMode
  mobileSection: 'moves' | 'stats' | 'prep'
  explorerSource: ExplorerSource
  filters: Record<ExplorerSource, LichessDatabaseFilters>
  drillStartContext?: DrillStartContext
  drillStartMode?: DrillStartMode
}

function readViewSession(): Partial<ViewSession> {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(VIEW_SESSION_KEY) ?? '{}') as Partial<ViewSession>
    // Prefer the exact name over retaining the known-bad legacy
    // "Vienna Game, 2. Nc3" label when old state lacks resolution provenance.
    parsed.drillStartContext = migrateDrillStartContext(parsed.drillStartContext)
    return parsed
  } catch {
    return {}
  }
}

function App() {
  const [initialView] = useState(readViewSession)
  const { fen, moves, pointer, goTo, goBack, goForward, makeMove, reset, loadLine, loadPosition, loadContinuationPath } = useGame()
  const { theme, toggleTheme } = useTheme()
  const { boardColor, toggleBoardColor } = useBoardColor()
  const { token, setToken } = useLichessToken()
  const auth = useAuth()
  const isSignedIn = auth.user !== null
  const [explorerSource, setExplorerSource] = useState<ExplorerSource>(initialView.explorerSource ?? 'lichess')
  // Signed-out users have no "my games" source at all - always show the public database.
  const effectiveExplorerSource = isSignedIn ? explorerSource : 'lichess'
  // Each source owns its filters independently: switching tabs restores that
  // source's dates/game types instead of silently applying the other source's
  // selection. Rating bands exist only in the public-source entry.
  const [explorerFiltersBySource, setExplorerFiltersBySource] = useState<Record<ExplorerSource, LichessDatabaseFilters>>(initialView.filters ?? {
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
    auth.user?.id,
    auth.user?.lichessUsername ?? '',
  )
  const evaluation = useEngineEval(fen, isSignedIn)
  const repertoire = useRepertoire(auth.user)
  const { soundEnabled, toggleSound, playMoveSound, playDrillCompleteSound, playWrongMoveSound } = useSound()
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null)
  const [mode, setMode] = useState<AppMode>(initialView.mode ?? 'explorer')
  const [mobileExplorerSection, setMobileExplorerSection] = useState<'moves' | 'stats' | 'prep'>(initialView.mobileSection ?? 'stats')
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false)
  const [drillStartContext, setDrillStartContext] = useState<DrillStartContext | undefined>(initialView.drillStartContext)
  const [drillStartMode, setDrillStartMode] = useState<DrillStartMode>(
    initialView.drillStartContext ? (initialView.drillStartMode ?? 'selected_position') : 'beginning',
  )
  const [drillMounted, setDrillMounted] = useState(initialView.mode === 'drill' || Boolean(initialView.drillStartContext))

  const handleModeChange = useCallback((nextMode: AppMode) => {
    // Mount lazily on the first visit, then keep the drill alive while Explorer
    // is visible so switching back resumes the same session. Restarting is an
    // explicit action inside DrillView.
    if (nextMode === 'drill' && !drillMounted) {
      setDrillStartContext(undefined)
      setDrillStartMode('beginning')
      setDrillMounted(true)
    }
    setMode(nextMode)
  }, [drillMounted])

  const resetDrillStartPosition = useCallback(() => {
    setDrillStartContext(undefined)
    setDrillStartMode('beginning')
    setDrillMounted(false)
    requestAnimationFrame(() => setDrillMounted(true))
  }, [])

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

  useEffect(() => {
    try {
      sessionStorage.setItem(VIEW_SESSION_KEY, JSON.stringify({
        mode,
        mobileSection: mobileExplorerSection,
        explorerSource,
        filters: explorerFiltersBySource,
        drillStartContext,
        drillStartMode,
      } satisfies ViewSession))
    } catch {
      // The page remains usable if tab-scoped storage is unavailable.
    }
  }, [mode, mobileExplorerSection, explorerSource, explorerFiltersBySource, drillStartContext, drillStartMode])

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
      const conflicts = findResponseConflicts(repertoire.getEditingTree(boardColor), boardColor, steps)
      if (conflicts.length > 0) {
        const replace = window.confirm("This module already has a different response at this position. Replace that response and its continuation? Cancel to keep it and choose or create another module instead.")
        if (!replace) return
      }
      repertoire.addLine(boardColor, steps, 'manual', '', [], conflicts.length > 0 ? 'replace' : 'reject')
    },
    [moves, boardColor, repertoire],
  )

  const handleToggleBoardColor = useCallback(() => {
    toggleBoardColor()
    reset()
  }, [toggleBoardColor, reset])

  const getRepertoireContinuations = repertoire.getContinuations
  const coverageContinuations = useCallback(
    (positionFen: string) => getRepertoireContinuations(boardColor, positionFen),
    [boardColor, getRepertoireContinuations],
  )
  const openCoveragePosition = useCallback((positionFen: string) => {
    if (!loadPosition(positionFen)) return
    setMobileExplorerSection('stats')
  }, [loadPosition])

  const playRepertoirePath = useCallback((path: RepertoireMove[]) => {
    if (!loadContinuationPath(path.map((move) => move.uci))) return
    const destination = path.at(-1)
    if (destination) playMoveSound(destination.san)
  }, [loadContinuationPath, playMoveSound])
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
  // for the line rather than showing an unavailable-name fallback.
  const openingNameCache = useRef(new Map<string, ExplorerOpening>()).current
  useEffect(() => {
    if (explorer.data) {
      if (explorer.data.opening) openingNameCache.set(fen, explorer.data.opening)
      const position = new Chess(fen)
      for (const candidate of explorer.data.moves) {
        if (!candidate.opening) continue
        const child = new Chess(position.fen())
        try {
          child.move(candidate.uci)
          openingNameCache.set(child.fen(), candidate.opening)
        } catch {
          // Ignore malformed upstream moves; the statistics row remains usable.
        }
      }
    }
  }, [fen, explorer.data, openingNameCache])

  const resolvedOpening = useMemo<{ opening: NonNullable<ExplorerOpening>, ply: number } | null>(() => {
    const live = explorer.data?.opening ?? null
    if (live) return { opening: live, ply: pointer }
    const current = openingNameCache.get(fen)
    if (current) return { opening: current, ply: pointer }
    for (let ply = pointer - 1; ply >= 0; ply--) {
      const ancestorFen = ply === 0 ? START_FEN : moves[ply - 1].fenAfter
      const cached = openingNameCache.get(ancestorFen)
      if (cached) return { opening: cached, ply }
    }
    return null
  }, [explorer.data, fen, pointer, moves, openingNameCache])

  const selectCurrentDrillStartPosition = useCallback(() => {
    setDrillStartContext(createDrillStartContext(fen, pointer, moves, {
      openingName: resolvedOpening?.opening.name,
      openingEco: resolvedOpening?.opening.eco,
      openingNamePly: resolvedOpening?.ply,
      positionMoveLabel: openingDisambiguationLabel(moves, pointer, resolvedOpening?.ply ?? null),
    }))
    setDrillStartMode('selected_position')
  }, [fen, moves, pointer, resolvedOpening])

  const startDrillFromPosition = useCallback(() => {
    selectCurrentDrillStartPosition()
    setDrillMounted(true)
    setMode('drill')
  }, [selectCurrentDrillStartPosition])

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
    const styles: Record<string, CSSProperties> = {}
    const lastMoveUci = pointer > 0 ? moves[pointer - 1]?.uci : undefined
    if (lastMoveUci) {
      styles[lastMoveUci.slice(0, 2)] = LAST_MOVE_SQUARE_STYLE
      styles[lastMoveUci.slice(2, 4)] = LAST_MOVE_SQUARE_STYLE
    }
    if (selectedSquare) {
      styles[selectedSquare] = { ...styles[selectedSquare], ...SELECTED_SQUARE_STYLE }
      for (const move of legalMoves) {
        styles[move.to] = {
          ...styles[move.to],
          ...(move.isCapture() ? CAPTURE_TARGET_STYLE : LEGAL_TARGET_STYLE),
        }
      }
    }
    return Object.keys(styles).length > 0 ? styles : undefined
  }, [selectedSquare, legalMoves, moves, pointer])

  function handlePieceDrop({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean {
    // A drag is a new interaction, independent of any earlier tap-to-move
    // selection. Clear it even when the drop is cancelled or illegal so a
    // stale origin/highlight cannot remain on the board.
    setSelectedSquare(null)
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
        <h1>Mainline</h1>
        <p>Opening explorer &amp; repertoire builder</p>
        <ModeToggle mode={mode} onChange={handleModeChange} />
        <button
          type="button"
          className="mobile-settings-button"
          aria-label={mobileSettingsOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileSettingsOpen}
          aria-controls="header-settings"
          onClick={() => setMobileSettingsOpen((open) => !open)}
        >
          <span aria-hidden="true">{mobileSettingsOpen ? '×' : '☰'}</span>
        </button>
        <div id="header-settings" className={`header-controls ${mobileSettingsOpen ? 'mobile-open' : ''}`}>
          <div className="mobile-repertoire-color">
            <BoardColorToggle boardColor={boardColor} onToggle={handleToggleBoardColor} />
          </div>
          {mode === 'drill' && (
            <fieldset className="header-drill-start-mode">
              <legend>Drill starting point</legend>
              <label>
                <input
                  type="radio"
                  name="drill-start-mode"
                  value="selected_position"
                  checked={drillStartMode === 'selected_position' && drillStartContext !== undefined}
                  onChange={selectCurrentDrillStartPosition}
                />
                Start at selected position
              </label>
              <label>
                <input
                  type="radio"
                  name="drill-start-mode"
                  value="beginning"
                  checked={drillStartMode === 'beginning' || drillStartContext === undefined}
                  onChange={() => setDrillStartMode('beginning')}
                />
                Start from move 1
              </label>
            </fieldset>
          )}
          <RepertoireProfileControls
            profiles={repertoire.profiles}
            modules={repertoire.modules}
            activeProfileId={repertoire.activeProfileId}
            editingModuleId={repertoire.editingModuleIds[boardColor] ?? null}
            editingLinePaths={repertoire.editingLinePaths[boardColor] ?? []}
            editingTree={repertoire.getEditingTree(boardColor)}
            color={boardColor}
            disabled={repertoire.isSyncing}
            showGlobalLibrary
            canManageGlobalLibrary={isSignedIn}
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
            previewRelease={repertoire.previewRelease}
            onPreviewTemplate={repertoire.setPreviewRelease}
          />
          <SoundToggle soundEnabled={soundEnabled} onToggle={toggleSound} />
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <AuthControl
            user={auth.user}
            loading={auth.loading}
            onGoogleLogin={auth.loginWithGoogle}
            onLinkLichess={auth.linkLichess}
            onLinkChessCom={auth.linkChessCom}
            onUnlinkChessCom={auth.unlinkChessCom}
            onLogout={auth.logout}
          />
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
      <AccountMergePrompt
        preview={auth.lichessMerge}
        busy={auth.lichessMergeBusy}
        error={auth.lichessMergeError}
        onConfirm={auth.confirmLichessMerge}
        onCancel={auth.cancelLichessMerge}
      />
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
            active={mode === 'drill'}
            repertoire={repertoire}
            color={boardColor}
            onToggleColor={handleToggleBoardColor}
            playMoveSound={playMoveSound}
            playDrillCompleteSound={playDrillCompleteSound}
            playWrongMoveSound={playWrongMoveSound}
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
            startMode={drillStartMode}
            onViewInExplorer={viewDrillCompletionInExplorer}
            onResetStartPosition={resetDrillStartPosition}
          />
        </div>
      )}
      {mode === 'explorer' && (
        <main className="explorer-layout">
          <nav className="mobile-section-tabs" aria-label="Explorer sections" role="tablist">
            {(['moves', 'stats', 'prep'] as const).map((section) => (
              <button
                key={section}
                type="button"
                role="tab"
                aria-selected={mobileExplorerSection === section}
                aria-controls={`mobile-${section}-panel`}
                className={mobileExplorerSection === section ? 'active' : ''}
                onClick={() => setMobileExplorerSection(section)}
              >
                {section[0].toUpperCase() + section.slice(1)}
              </button>
            ))}
          </nav>
          <section
            id="mobile-moves-panel"
            className={`panel moves-panel mobile-section-panel ${mobileExplorerSection === 'moves' ? 'mobile-active' : ''}`}
            role="tabpanel"
          >
            <h2>Moves</h2>
            <MoveList
              moves={moves}
              pointer={pointer}
              currentFen={fen}
              onSelect={goTo}
              boardColor={boardColor}
              isPlySaved={isPlySaved}
              onTogglePlySaved={onTogglePlySaved}
              getContinuations={coverageContinuations}
              onPlayContinuationPath={playRepertoirePath}
            />
          </section>

          <div className="board-column">
            <div className="board-heading">
              <OpeningName eco={resolvedOpening?.opening.eco ?? null} name={resolvedOpening?.opening.name ?? null} fen={fen} />
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

          <div className={`side-column ${mobileExplorerSection !== 'stats' ? 'mobile-section-container-hidden' : ''}`}>
            <section
              id="mobile-stats-panel"
              className={`panel explorer-panel mobile-section-panel ${mobileExplorerSection === 'stats' ? 'mobile-active' : ''}`}
              role="tabpanel"
            >
              <h2>Lichess explorer</h2>
              <div className="explorer-toolbar">
                {isSignedIn && <ExplorerSourceToggle source={explorerSource} onChange={setExplorerSource} />}
                <ExplorerFiltersPanel
                  source={effectiveExplorerSource}
                  filters={explorerFilters}
                  onChange={setExplorerFilters}
                />
              </div>
              {!isSignedIn && <LichessTokenSettings token={token} onChange={setToken} />}
              <ExplorerStatsTable
                data={explorer.data}
                loading={explorer.loading}
                error={explorer.error}
                onMoveClick={(san) => playMove(san)}
                isMoveSaved={isExplorerMoveSaved}
                isMyMove={isExplorerMyMove}
                isPolling={explorer.isPolling}
                pollExhausted={explorer.pollExhausted}
                onRetry={explorer.retry}
                linkLichessHref={lichessLoginUrl(window.location.pathname + window.location.search + window.location.hash)}
              />
              {positionCoverage && positionCoverage.totalGames > 0 && (
                <p className="panel-status">
                  Prepared-response coverage: <strong>{positionCoverage.percent.toFixed(1)}%</strong>{' '}
                  ({positionCoverage.coveredMoves}/{positionCoverage.totalMoves} replies, weighted by games)
                </p>
              )}
            </section>
          </div>
          <div
            id="mobile-prep-panel"
            className={`explorer-prep-tools ${mobileExplorerSection !== 'prep' ? 'mobile-section-container-hidden' : ''}`}
            role="tabpanel"
          >
            <section className="panel">
              <CoverageDashboard
                color={boardColor}
                tree={repertoire.getTree(boardColor)}
                apiToken={token}
                signedIn={isSignedIn}
                filters={explorerFiltersBySource.lichess}
                getContinuations={coverageContinuations}
                onOpenPosition={openCoveragePosition}
              />
            </section>
            <OpeningGeneratorPanel
              color={boardColor}
              prefixUci={moves.slice(0, pointer).map((move) => move.uci)}
              openingName={resolvedOpening?.opening.name}
              lichessToken={token}
              onAddLines={async (name, pgn) => {
                const lines = parsePgnLinesWithMetadata(pgn)
                if (findResponseConflicts({}, boardColor, lines.flatMap((line) => line.steps)).length > 0) throw new Error("The generated tree contains more than one repertoire response at a position and cannot become a single module.")
                await repertoire.importModule(boardColor, name, lines, repertoire.activeProfileId ?? undefined)
                return lines.length
              }}
            />
            <section className="panel">
              <h2>PGN</h2>
              <PgnImportExportPanel
                color={boardColor}
                getTree={repertoire.getTree}
                getEditingTree={repertoire.getEditingTree}
                getLines={(color) => repertoire.editingLines[color] ?? []}
                isMoveSaved={repertoire.isMoveSaved}
                addLine={repertoire.addLine}
                createModuleFromLines={(name, lines) => repertoire.importModule(boardColor, name, lines, repertoire.activeProfileId ?? undefined)}
              />
            </section>
          </div>
        </main>
      )}
    </div>
  )
}

export default App
