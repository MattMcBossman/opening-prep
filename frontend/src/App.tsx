import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Chessboard } from 'react-chessboard'
import type { PieceDataType, PieceDropHandlerArgs, SquareHandlerArgs } from 'react-chessboard'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import { useGame, START_FEN } from './hooks/useGame'
import type { GameSnapshot, MoveInput } from './hooks/useGame'
import { useAuth } from './hooks/useAuth'
import { useExplorerStats } from './hooks/useExplorerStats'
import { useEngineEval } from './hooks/useEngineEval'
import { useTheme } from './hooks/useTheme'
import { useBoardColor } from './hooks/useBoardColor'
import { useHistoryKeyboardNav } from './hooks/useHistoryKeyboardNav'
import { useResetKeyboardShortcut } from './hooks/useResetKeyboardShortcut'
import type { ExplorerSource } from './hooks/useExplorerStats'
import { useRepertoire } from './hooks/useRepertoire'
import { fetchExplorerStats } from './lib/lichessExplorer'
import type { LichessDatabaseFilters } from './lib/lichessExplorer'
import { useSound } from './hooks/useSound'
import { useMainlineGuide } from './hooks/useMainlineGuide'
import { installAudioUnlock } from './audio/soundPlayer'
import { MoveList } from './components/MoveList'
import { ExplorerStatsTable } from './components/ExplorerStatsTable'
import { EngineEvalPanel } from './components/EngineEvalPanel'
import { EvalBar } from './components/EvalBar'
import { OpeningName } from './components/OpeningName'
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
import { MainlineGuide } from './components/MainlineGuide'
import type { AppMode } from './components/ModeToggle'
import { DrillView } from './components/DrillView'
import { normalizeFen, originFenForPly, sideToMove } from './lib/chessUtils'
import { inheritedOpeningName, OPENING_NAME_GUARANTEE_MIN_GAMES } from './lib/openingName'
import { createDrillStartContext, migrateDrillStartContext, openingDisambiguationLabel, prepareDrillLines } from './lib/repertoireDrills'
import type { DrillLine, DrillStartContext, DrillStartMode } from './lib/repertoireDrills'
import { calculatePositionCoverage } from './lib/repertoireCoverage'
import { addMoveToTree, findResponseConflicts, removeMoveFromTree } from './lib/repertoireTree'
import { diffModuleDraft, moduleMoveDraftState } from './lib/moduleDraftDiff'
import { TUTORIAL_VIENNA_TREE, tutorialPersonalGameStats, tutorialPositionStats } from './lib/tutorialDemo'
import type { RepertoireColor, RepertoireMove, RepertoireTree } from './types'
import { googleLoginUrl, lichessLoginUrl } from './lib/authApi'
import type { OpeningTemplateRelease, RepertoireLine as ApiRepertoireLine, RepertoireSummary } from './lib/repertoireApi'
import './App.css'

const SELECTED_SQUARE_STYLE: CSSProperties = { backgroundColor: 'rgba(0, 0, 0, 0.2)' }
// react-chessboard otherwise adds its own black border to the drag target.
// All destination highlighting is owned by `squareStyles` below so the same
// translucent layer is used for click and drag interactions exactly once.
const DROP_SQUARE_STYLE: CSSProperties = { boxShadow: 'none' }
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

function pieceMatchesColor(piece: PieceDataType | null, color: 'white' | 'black'): boolean {
  return piece?.pieceType.startsWith(color === 'white' ? 'w' : 'b') ?? false
}

const VIEW_SESSION_KEY = 'opening-prep:view-session:v1'
const WALKTHROUGH_START_LINE = ['e2e4', 'e7e5'] as const
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
  const { fen, moves, pointer, goTo, goBack, goForward, makeMove, reset, loadLine, loadPosition, loadContinuationPath, boardTransition, snapshot: gameSnapshot, restoreSnapshot } = useGame()
  const { theme, toggleTheme } = useTheme()
  const { boardColor, setBoardColor, toggleBoardColor } = useBoardColor()
  const token = ''
  const auth = useAuth()
  const isSignedIn = auth.user !== null
  const [tutorialActive, setTutorialActive] = useState(false)
  const latestGameSnapshotRef = useRef(gameSnapshot)
  const preWalkthroughGameRef = useRef<GameSnapshot | null>(null)
  latestGameSnapshotRef.current = gameSnapshot
  const handleWalkthroughActiveChange = useCallback((active: boolean) => {
    if (active) {
      if (preWalkthroughGameRef.current) return
      preWalkthroughGameRef.current = latestGameSnapshotRef.current
      loadLine(WALKTHROUGH_START_LINE)
      setTutorialActive(true)
      return
    }
    setTutorialActive(false)
    const saved = preWalkthroughGameRef.current
    preWalkthroughGameRef.current = null
    if (saved) restoreSnapshot(saved)
  }, [loadLine, restoreSnapshot])
  const handleWalkthroughManagerChange = useCallback((view: 'modules' | null) => {
    setWalkthroughManagerRequest((request) => ({ id: request.id + 1, view }))
  }, [])
  const [openLibraryRequest, setOpenLibraryRequest] = useState(0)
  const [walkthroughManagerRequest, setWalkthroughManagerRequest] = useState<{ id: number; view: 'modules' | null }>({ id: 0, view: null })
  const [explorerSource, setExplorerSource] = useState<ExplorerSource>(initialView.explorerSource ?? 'lichess')
  const effectiveExplorerSource = explorerSource
  // Each source owns its filters independently: switching tabs restores that
  // source's dates/game types instead of silently applying the other source's
  // selection. Rating bands exist only in the public-source entry.
  const [explorerFiltersBySource, setExplorerFiltersBySource] = useState<Record<ExplorerSource, LichessDatabaseFilters>>(initialView.filters ?? {
    lichess: {},
    'my-games': {},
  })
  const explorerFilters = explorerFiltersBySource[effectiveExplorerSource]
  const displayedExplorerSource = effectiveExplorerSource
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
  // Opening identity is always sourced from the public Lichess database for
  // this exact board FEN. It deliberately ignores the selected stats source,
  // player-game filters, module names, and ancestor positions.
  const openingExplorer = useExplorerStats(
    fen,
    token,
    true,
    isSignedIn,
    'lichess',
    boardColor,
    {},
    auth.user?.id,
    auth.user?.lichessUsername ?? '',
  )
  const [ancestorOpening, setAncestorOpening] = useState<{ eco: string; name: string } | null>(null)
  const [ancestorOpeningLoading, setAncestorOpeningLoading] = useState(false)
  const evaluation = useEngineEval(fen, isSignedIn)
  const tutorialStats = useMemo(() => tutorialPositionStats(fen), [fen])
  const tutorialDisplayedStats = useMemo(
    () => displayedExplorerSource === 'my-games' ? tutorialPersonalGameStats(fen) : tutorialStats,
    [displayedExplorerSource, fen, tutorialStats],
  )
  const repertoire = useRepertoire(auth.user)
  type PendingModuleChange =
    | { kind: 'remove'; color: RepertoireColor; originFen: string; uci: string }
    | { kind: 'add-line'; color: RepertoireColor; steps: Array<{ originFen: string; san: string; uci: string; resultingFen: string }>; source: 'manual' | 'pgn_import'; label: string; annotations: ApiRepertoireLine['annotations']; conflictPolicy: 'reject' | 'replace' }
  const [moduleWorkspaceMode, setModuleWorkspaceMode] = useState<'viewing' | 'editing'>('viewing')
  const [newModuleSelected, setNewModuleSelected] = useState(false)
  const [moduleDraftTree, setModuleDraftTree] = useState<RepertoireTree | null>(null)
  const [draftSourceRelease, setDraftSourceRelease] = useState<OpeningTemplateRelease | null>(null)
  const [pendingModuleChanges, setPendingModuleChanges] = useState<PendingModuleChange[]>([])
  const [moduleSaveConfirmOpen, setModuleSaveConfirmOpen] = useState(false)
  const [moduleWorkspaceNotice, setModuleWorkspaceNotice] = useState<string | null>(null)
  const [readOnlyStarNotice, setReadOnlyStarNotice] = useState<{ message: string; x: number; y: number } | null>(null)
  const { soundEnabled, toggleSound, playMoveSound, playDrillCompleteSound, playWrongMoveSound } = useSound()
  const mainlineGuide = useMainlineGuide()
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null)
  const [hoveredSquare, setHoveredSquare] = useState<string | null>(null)
  const [mode, setMode] = useState<AppMode>(initialView.mode ?? 'explorer')
  const [mobileExplorerSection, setMobileExplorerSection] = useState<'moves' | 'stats' | 'prep'>(initialView.mobileSection ?? 'stats')
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false)
  const [drillStartContext, setDrillStartContext] = useState<DrillStartContext | undefined>(initialView.drillStartContext)
  const [drillStartMode, setDrillStartMode] = useState<DrillStartMode>(
    initialView.drillStartContext ? (initialView.drillStartMode ?? 'selected_position') : 'beginning',
  )
  const [drillMounted, setDrillMounted] = useState(initialView.mode === 'drill' || Boolean(initialView.drillStartContext))
  const [moduleDrill, setModuleDrill] = useState<{ module: RepertoireSummary; lines: DrillLine[] } | null>(null)

  useEffect(() => {
    if (!mobileSettingsOpen) return
    const previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    setSelectedSquare(null)
    setHoveredSquare(null)
    return () => {
      document.body.style.overflow = previousBodyOverflow
    }
  }, [mobileSettingsOpen])

  const selectedModuleId = repertoire.editingModuleIds[boardColor] ?? null
  const viewedRelease = repertoire.previewRelease?.color === boardColor ? repertoire.previewRelease : null
  const persistedModuleTree = viewedRelease?.tree ?? repertoire.getEditingTree(boardColor)
  const moduleWorkspaceTree = tutorialActive
    ? TUTORIAL_VIENNA_TREE
    : moduleWorkspaceMode === 'editing' && moduleDraftTree ? moduleDraftTree : persistedModuleTree
  const moduleDraftDiff = useMemo(
    () => diffModuleDraft(newModuleSelected || draftSourceRelease ? {} : persistedModuleTree, moduleDraftTree ?? persistedModuleTree, boardColor),
    [boardColor, draftSourceRelease, moduleDraftTree, newModuleSelected, persistedModuleTree],
  )
  const hasUnsavedModuleChanges = draftSourceRelease !== null || moduleDraftDiff.moves.length > 0 || moduleDraftDiff.lines.length > 0

  useEffect(() => {
    setModuleWorkspaceMode('viewing')
    setNewModuleSelected(false)
    setModuleDraftTree(null)
    setDraftSourceRelease(null)
    setPendingModuleChanges([])
    setModuleSaveConfirmOpen(false)
    setModuleWorkspaceNotice(null)
  }, [boardColor, selectedModuleId, viewedRelease?.id])

  useEffect(() => {
    if (!hasUnsavedModuleChanges) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasUnsavedModuleChanges])

  useEffect(() => {
    if (!readOnlyStarNotice) return
    const timer = window.setTimeout(() => setReadOnlyStarNotice(null), 2200)
    return () => window.clearTimeout(timer)
  }, [readOnlyStarNotice])

  const beginEditingModule = useCallback(() => {
    setNewModuleSelected(false)
    setModuleDraftTree(structuredClone(persistedModuleTree))
    setDraftSourceRelease(!isSignedIn ? viewedRelease : null)
    setPendingModuleChanges([])
    setModuleWorkspaceNotice(null)
    setModuleWorkspaceMode('editing')
  }, [isSignedIn, persistedModuleTree, viewedRelease])

  const discardModuleChanges = useCallback(() => {
    if (draftSourceRelease) {
      setDraftSourceRelease(null)
      setModuleDraftTree(null)
      setPendingModuleChanges([])
      setModuleWorkspaceNotice(null)
      setModuleWorkspaceMode('viewing')
      return
    }
    if (newModuleSelected) {
      setModuleDraftTree({})
      setPendingModuleChanges([])
      setModuleWorkspaceNotice(null)
      return
    }
    setNewModuleSelected(false)
    setModuleDraftTree(null)
    setPendingModuleChanges([])
    setModuleWorkspaceNotice(null)
    setModuleWorkspaceMode('viewing')
  }, [draftSourceRelease, newModuleSelected])

  const saveModuleChanges = useCallback(async () => {
    setModuleSaveConfirmOpen(false)
    if (newModuleSelected || draftSourceRelease) {
      const requestedName = draftSourceRelease?.name ?? window.prompt('Name this opening module')
      if (requestedName === null) return
      const name = requestedName.trim()
      if (!name) {
        setModuleWorkspaceNotice('Enter a name before saving the new module.')
        return
      }
      if (repertoire.modules.some((module) => module.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
        setModuleWorkspaceNotice('Choose a different name; that module already exists.')
        return
      }
      const retainedReleaseLines = draftSourceRelease?.lines
        .filter((line) => line.steps.every((step) => (moduleDraftTree?.[normalizeFen(step.originFen)] ?? []).some((move) => move.uci === step.uci)))
        .map((line) => ({ steps: line.steps, label: line.label, annotations: [] })) ?? []
      const addedLines = pendingModuleChanges.flatMap((change) => change.kind === 'add-line'
        && change.steps.every((step) => (moduleDraftTree?.[normalizeFen(step.originFen)] ?? []).some((move) => move.uci === step.uci))
        ? [{ steps: change.steps, label: change.label, annotations: change.annotations }]
        : [])
      const lines = [...retainedReleaseLines, ...addedLines]
      let created: unknown
      try {
        created = lines.length > 0
          ? await repertoire.importModule(boardColor, name, lines)
          : await repertoire.createModule(boardColor, name)
      } catch (error) {
        setModuleWorkspaceNotice(error instanceof Error ? error.message : 'The new module could not be saved.')
        return
      }
      if (created && typeof created === 'object' && 'id' in created && typeof created.id === 'number') {
        repertoire.setEditingModule(boardColor, created.id)
      }
      setNewModuleSelected(false)
      setDraftSourceRelease(null)
      repertoire.setPreviewRelease(null)
      setModuleDraftTree(null)
      setPendingModuleChanges([])
      setModuleWorkspaceNotice('Module saved.')
      setModuleWorkspaceMode('viewing')
      return
    }
    try {
      for (const change of pendingModuleChanges) {
        if (change.kind === 'remove') await repertoire.removeMove(change.color, change.originFen, change.uci)
        else await repertoire.addLine(change.color, change.steps, change.source, change.label, change.annotations, change.conflictPolicy)
      }
    } catch (error) {
      setModuleWorkspaceNotice(error instanceof Error ? `Module could not be saved: ${error.message}` : 'Module could not be saved. Your edits are still open.')
      return
    }
    setModuleDraftTree(null)
    setPendingModuleChanges([])
    setModuleWorkspaceNotice('Module saved.')
    setModuleWorkspaceMode('viewing')
  }, [boardColor, draftSourceRelease, moduleDraftTree, newModuleSelected, pendingModuleChanges, repertoire])

  const addLineToModuleDraft = useCallback((
    color: RepertoireColor,
    steps: Array<{ originFen: string; san: string; uci: string; resultingFen: string }>,
    source: 'manual' | 'pgn_import' = 'manual',
    label = '',
    annotations: ApiRepertoireLine['annotations'] = [],
    conflictPolicy: 'reject' | 'replace' = 'reject',
  ) => {
    if (moduleWorkspaceMode !== 'editing' || !moduleDraftTree || color !== boardColor) {
      setModuleWorkspaceNotice('Select Edit before importing lines into this module.')
      return
    }
    const conflicts = findResponseConflicts(moduleDraftTree, color, steps)
    if (conflicts.length > 0 && conflictPolicy === 'reject') return
    let nextTree = moduleDraftTree
    if (conflictPolicy === 'replace') {
      for (const conflict of conflicts) nextTree = removeMoveFromTree(nextTree, color, conflict.originFen, conflict.existingUci)
    }
    for (const step of steps) nextTree = addMoveToTree(nextTree, step.originFen, step)
    setModuleDraftTree(nextTree)
    setPendingModuleChanges((current) => [...current, { kind: 'add-line', color, steps, source, label, annotations, conflictPolicy }])
    setModuleWorkspaceNotice(null)
  }, [boardColor, moduleDraftTree, moduleWorkspaceMode])

  const allowLeavingModuleDraft = useCallback(() => {
    if (!hasUnsavedModuleChanges) return true
    if (!window.confirm('Discard the unsaved changes to this module?')) return false
    setNewModuleSelected(false)
    setModuleDraftTree(null)
    setPendingModuleChanges([])
    setModuleWorkspaceNotice(null)
    setModuleWorkspaceMode('viewing')
    return true
  }, [hasUnsavedModuleChanges])

  const beginNewModule = useCallback(() => {
    if (!allowLeavingModuleDraft()) return
    repertoire.setPreviewRelease(null)
    setNewModuleSelected(true)
    setModuleDraftTree({})
    setPendingModuleChanges([])
    setModuleWorkspaceNotice(null)
    setModuleWorkspaceMode('editing')
  }, [allowLeavingModuleDraft, repertoire])

  const viewModule = useCallback((moduleId: number) => {
    repertoire.setPreviewRelease(null)
    setNewModuleSelected(false)
    setModuleDraftTree(null)
    setPendingModuleChanges([])
    setModuleWorkspaceNotice(null)
    setModuleWorkspaceMode('viewing')
    repertoire.setEditingModule(boardColor, moduleId)
  }, [boardColor, repertoire])

  useEffect(() => {
    if (repertoire.isSyncing || viewedRelease || newModuleSelected) return
    if (repertoire.modules.some((module) => module.color === boardColor)) return
    setNewModuleSelected(true)
    setModuleDraftTree({})
    setPendingModuleChanges([])
    setModuleWorkspaceMode('editing')
  }, [boardColor, newModuleSelected, repertoire.isSyncing, repertoire.modules, viewedRelease])

  const handleModeChange = useCallback((nextMode: AppMode) => {
    if (nextMode !== mode && !allowLeavingModuleDraft()) return
    // Mount lazily on the first visit, then keep the drill alive while Explorer
    // is visible so switching back resumes the same session. Restarting is an
    // explicit action inside DrillView.
    if (nextMode === 'drill' && !drillMounted) {
      setModuleDrill(null)
      setDrillStartContext(undefined)
      setDrillStartMode('beginning')
      setDrillMounted(true)
    }
    setMode(nextMode)
  }, [allowLeavingModuleDraft, drillMounted, mode])

  const resetDrillStartPosition = useCallback(() => {
    setModuleDrill(null)
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
  useResetKeyboardShortcut(reset, mode === 'explorer')

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
      return (moduleWorkspaceTree[normalizeFen(originFenForPly(moves, index))] ?? []).some((move) => move.uci === entry.uci)
    },
    [moves, moduleWorkspaceTree],
  )

  const getPlySaveState = useCallback(
    (index: number) => {
      const entry = moves[index]
      if (!entry) return 'unsaved' as const
      const originFen = originFenForPly(moves, index)
      return moduleWorkspaceMode === 'editing' && moduleDraftTree
        ? moduleMoveDraftState(newModuleSelected ? {} : persistedModuleTree, moduleDraftTree, originFen, entry.uci)
        : (isPlySaved(index) ? 'saved' as const : 'unsaved' as const)
    },
    [isPlySaved, moduleDraftTree, moduleWorkspaceMode, moves, newModuleSelected, persistedModuleTree],
  )

  const onTogglePlySaved = useCallback(
    (index: number, point: { x: number; y: number }) => {
      const entry = moves[index]
      if (!entry) return
      const originFen = originFenForPly(moves, index)
      if (moduleWorkspaceMode !== 'editing' || !moduleDraftTree) {
        setReadOnlyStarNotice({
          message: viewedRelease ? 'Save a copy to change this module.' : 'Select Edit to change this module.',
          x: Math.max(8, Math.min(point.x + 10, window.innerWidth - 230)),
          y: Math.max(8, Math.min(point.y + 10, window.innerHeight - 70)),
        })
        return
      }
      if ((moduleDraftTree[normalizeFen(originFen)] ?? []).some((move) => move.uci === entry.uci)) {
        setModuleDraftTree(removeMoveFromTree(moduleDraftTree, boardColor, originFen, entry.uci))
        setPendingModuleChanges((current) => [...current, { kind: 'remove', color: boardColor, originFen, uci: entry.uci }])
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
      const conflicts = findResponseConflicts(moduleDraftTree, boardColor, steps)
      if (conflicts.length > 0) {
        const replace = window.confirm("This module already has a different response at this position. Replace that response and its continuation? Cancel to keep it and choose or create another module instead.")
        if (!replace) return
      }
      let nextTree = moduleDraftTree
      if (conflicts.length > 0) {
        for (const conflict of conflicts) nextTree = removeMoveFromTree(nextTree, boardColor, conflict.originFen, conflict.existingUci)
      }
      for (const step of steps) nextTree = addMoveToTree(nextTree, step.originFen, step)
      setModuleDraftTree(nextTree)
      setPendingModuleChanges((current) => [...current, { kind: 'add-line', color: boardColor, steps, source: 'manual', label: '', annotations: [], conflictPolicy: conflicts.length > 0 ? 'replace' : 'reject' }])
      setModuleWorkspaceNotice(null)
    },
    [moves, boardColor, moduleWorkspaceMode, moduleDraftTree, viewedRelease],
  )

  const handleToggleBoardColor = useCallback(() => {
    if (!allowLeavingModuleDraft()) return
    setModuleDrill(null)
    toggleBoardColor()
    reset()
  }, [allowLeavingModuleDraft, toggleBoardColor, reset])

  const coverageContinuations = useCallback(
    (positionFen: string) => moduleWorkspaceTree[normalizeFen(positionFen)] ?? [],
    [moduleWorkspaceTree],
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
    (uci: string) => (moduleWorkspaceTree[normalizeFen(fen)] ?? []).some((move) => move.uci === uci),
    [moduleWorkspaceTree, fen],
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

  useEffect(() => {
    setAncestorOpening(null)
    setAncestorOpeningLoading(false)
    if (openingExplorer.loading || openingExplorer.data?.opening || pointer === 0 || !isSignedIn) return
    const controller = new AbortController()
    setAncestorOpeningLoading(true)
    const findDeepestNamedAncestor = async () => {
      // A low-volume current position inherits the nearest earlier resolved
      // label. If an unnamed ancestor crossed the guarantee threshold, that
      // ancestor's path-specific label is what descendants inherit; their own
      // low-volume moves are not appended.
      let guaranteedPly = (openingExplorer.data?.totalGames ?? 0) >= OPENING_NAME_GUARANTEE_MIN_GAMES
        ? pointer
        : null
      for (let ply = pointer - 1; ply >= 1; ply -= 1) {
        const ancestorFen = moves[ply - 1]?.fenAfter
        if (!ancestorFen) continue
        try {
          const result = await fetchExplorerStats(ancestorFen, {
            apiToken: token,
            signedIn: true,
            signal: controller.signal,
            filters: {},
          })
          if (!result.opening) {
            if (guaranteedPly === null && result.totalGames >= OPENING_NAME_GUARANTEE_MIN_GAMES) {
              guaranteedPly = ply
            }
            continue
          }
          if (!controller.signal.aborted) {
            setAncestorOpening({
              eco: result.opening.eco,
              name: inheritedOpeningName(
                result.opening.name,
                ply,
                guaranteedPly,
                guaranteedPly === null
                  ? []
                  : moves.slice(ply, guaranteedPly).map((move) => move.san),
              ),
            })
            setAncestorOpeningLoading(false)
          }
          return
        } catch {
          if (controller.signal.aborted) return
          // Try the next ancestor. Cached positions normally make this cheap;
          // an isolated upstream failure should not erase a usable older name.
        }
      }
      if (!controller.signal.aborted) setAncestorOpeningLoading(false)
    }
    void findDeepestNamedAncestor()
    return () => controller.abort()
  }, [isSignedIn, moves, openingExplorer.data?.opening, openingExplorer.data?.totalGames, openingExplorer.loading, pointer, token])

  const resolvedOpening = useMemo(() => {
    if (tutorialActive && tutorialStats.opening) return { opening: tutorialStats.opening, ply: pointer }
    if (openingExplorer.data?.opening) return { opening: openingExplorer.data.opening, ply: pointer }
    // The derived label already includes every move after the named ancestor,
    // so treat it as the current position's complete name. This prevents drill
    // handoff from appending the last move a second time.
    if (ancestorOpening) return { opening: { eco: ancestorOpening.eco, name: ancestorOpening.name }, ply: pointer }
    return null
  }, [ancestorOpening, openingExplorer.data?.opening, pointer, tutorialActive, tutorialStats.opening])

  const selectedModuleHasDrillContinuation = useMemo(() => {
    if (selectedModuleId === null) return false
    const context = createDrillStartContext(fen, pointer, moves)
    return prepareDrillLines(
      repertoire.getModuleDrillLines(selectedModuleId),
      'selected_position',
      context,
    ).lines.length > 0
  }, [fen, moves, pointer, repertoire, selectedModuleId])

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
    setModuleDrill(null)
    selectCurrentDrillStartPosition()
    setDrillMounted(true)
    setMode('drill')
  }, [selectCurrentDrillStartPosition])

  const startModuleDrill = useCallback((module: RepertoireSummary) => {
    const lines = repertoire.getModuleDrillLines(module.id)
    if (lines.length === 0) return
    const shortest = Math.min(...lines.map((line) => line.steps.length))
    let sharedPlies = 0
    while (sharedPlies < shortest && lines.every((line) => line.steps[sharedPlies].uci === lines[0].steps[sharedPlies].uci)) sharedPlies += 1
    const openingPlies = Math.min(sharedPlies, module.color === 'white' ? 3 : 2)
    const openingStep = openingPlies > 0 ? lines[0].steps[openingPlies - 1] : null
    setMobileSettingsOpen(false)
    repertoire.setPreviewRelease(null)
    setBoardColor(module.color)
    setModuleDrill({ module, lines })
    setDrillStartContext({
      selectedFen: openingStep?.resultingFen ?? START_FEN,
      selectedPly: openingPlies,
      prefixUci: lines[0].steps.slice(0, openingPlies).map((step) => step.uci),
      openingName: module.name,
    })
    setDrillStartMode('selected_position')
    setDrillMounted(false)
    setMode('drill')
    requestAnimationFrame(() => setDrillMounted(true))
  }, [repertoire, setBoardColor])

  // Any position change (drag move, click-to-move, explorer click, history navigation,
  // reset) invalidates the current selection.
  useEffect(() => {
    setSelectedSquare(null)
    setHoveredSquare(null)
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
      const hoveredTarget = hoveredSquare !== selectedSquare
        && legalMoves.some((move) => move.to === hoveredSquare)
        ? hoveredSquare
        : null
      for (const move of legalMoves) {
        if (move.to === hoveredTarget) continue
        styles[move.to] = {
          ...styles[move.to],
          ...(move.isCapture() ? CAPTURE_TARGET_STYLE : LEGAL_TARGET_STYLE),
        }
      }
      if (hoveredTarget) {
        styles[hoveredTarget] = { ...styles[hoveredTarget], ...SELECTED_SQUARE_STYLE }
      }
    }
    return Object.keys(styles).length > 0 ? styles : undefined
  }, [selectedSquare, hoveredSquare, legalMoves, moves, pointer])

  const isHistoryCaptureTransition = useMemo(() => {
    if (boardTransition.kind !== 'history') return false
    if (Math.abs(boardTransition.toPointer - boardTransition.fromPointer) !== 1) return false
    const move = moves[Math.max(boardTransition.fromPointer, boardTransition.toPointer) - 1]
    return move?.san.includes('x') ?? false
  }, [boardTransition, moves])
  const isUndoCaptureTransition = boardTransition.kind === 'history'
    && isHistoryCaptureTransition
    && boardTransition.toPointer < boardTransition.fromPointer

  function handlePieceDrop({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean {
    // A drag is a new interaction, independent of any earlier tap-to-move
    // selection. Clear it even when the drop is cancelled or illegal so a
    // stale origin/highlight cannot remain on the board.
    setSelectedSquare(null)
    setHoveredSquare(null)
    if (!targetSquare) return false
    return playMove({ from: sourceSquare, to: targetSquare, promotion: 'q' })
  }

  function handleSquareClick({ square, piece }: SquareHandlerArgs) {
    if (!selectedSquare) {
      if (pieceMatchesColor(piece, sideToMove(fen))) setSelectedSquare(square)
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
      setSelectedSquare(pieceMatchesColor(piece, sideToMove(fen)) ? square : null)
    }
  }

  return (
    <div className="app-layout">
      <header className="app-header">
        <button type="button" className="app-brand app-brand-button" onClick={mainlineGuide.show} aria-label="Open the Mainline guide" data-guide="brand">
          <svg className="app-logo" viewBox="0 0 64 64" aria-hidden="true">
            <path className="app-logo-rook" d="M8 9h12v9h7V9h10v9h7V9h12v17l-6 6v15l5 5v4H9v-4l5-5V32l-6-6V9Z" />
            <path className="app-logo-line" d="M29 21h6v35h-6V21Zm-9.5 6h4v7l5.5 5v5l-9.5-8v-9Zm25 4h-4v7L35 43v5l9.5-8v-9Z" />
          </svg>
          <h1>Mainline</h1>
        </button>
        <p>Opening explorer &amp; repertoire builder</p>
        <ModeToggle mode={mode} onChange={handleModeChange} guideTarget="modes" />
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
        {mobileSettingsOpen && (
          <button
            type="button"
            className="mobile-settings-backdrop"
            aria-label="Close menu"
            onClick={() => setMobileSettingsOpen(false)}
          />
        )}
        <div id="header-settings" className={`header-controls ${mobileSettingsOpen ? 'mobile-open' : ''}`}>
          <div className="header-module-controls">
            <BoardColorToggle boardColor={boardColor} onToggle={handleToggleBoardColor} />
            <RepertoireProfileControls
            context={mode}
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
            onEditingModuleChange={viewModule}
            onCreateModule={repertoire.createModule}
            onRenameModule={repertoire.renameModule}
            onDuplicateModule={repertoire.duplicateModule}
            onDrillModule={startModuleDrill}
            onDeleteModule={repertoire.deleteModule}
            onCopyTemplate={repertoire.copyTemplate}
            onCopyMissingTemplateLines={repertoire.copyMissingTemplateLines}
            previewRelease={repertoire.previewRelease}
            onPreviewTemplate={repertoire.setPreviewRelease}
            workspaceMode={moduleWorkspaceMode}
            newModuleSelected={newModuleSelected}
            hasUnsavedChanges={hasUnsavedModuleChanges}
            onNewModule={beginNewModule}
            onEditModule={beginEditingModule}
            onSaveModule={() => setModuleSaveConfirmOpen(true)}
            onDiscardModuleChanges={discardModuleChanges}
            openLibraryRequest={openLibraryRequest}
            walkthroughManagerRequest={walkthroughManagerRequest}
            />
          </div>
          {mode === 'drill' && (
            <fieldset className="drill-start-mode mobile-drill-start-mode">
              <legend>Drill starting point</legend>
              <label>
                <input
                  type="radio"
                  name="mobile-drill-start-mode"
                  value="selected_position"
                  checked={drillStartMode === 'selected_position' && drillStartContext !== undefined}
                  onChange={selectCurrentDrillStartPosition}
                />
                Start at selected position
              </label>
              <label>
                <input
                  type="radio"
                  name="mobile-drill-start-mode"
                  value="beginning"
                  checked={drillStartMode === 'beginning' || drillStartContext === undefined}
                  onChange={() => setDrillStartMode('beginning')}
                />
                Start from move 1
              </label>
            </fieldset>
          )}
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
      <MainlineGuide
        open={mainlineGuide.open}
        onClose={mainlineGuide.dismiss}
        onWalkthroughModeChange={handleModeChange}
        onWalkthroughSourceChange={setExplorerSource}
        onWalkthroughManagerChange={handleWalkthroughManagerChange}
        onWalkthroughSectionChange={setMobileExplorerSection}
        onWalkthroughActiveChange={handleWalkthroughActiveChange}
        onOpenLibrary={() => setOpenLibraryRequest((request) => request + 1)}
      />
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
      {moduleWorkspaceNotice && <p className="panel-status auth-error-banner" role="status">{moduleWorkspaceNotice}</p>}
      {readOnlyStarNotice && (
        <div
          className="cursor-notice"
          role="status"
          style={{ left: readOnlyStarNotice.x, top: readOnlyStarNotice.y }}
        >
          {readOnlyStarNotice.message}
        </div>
      )}
      {moduleSaveConfirmOpen && (
        <div className="module-save-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModuleSaveConfirmOpen(false) }}>
          <section className="module-save-dialog" role="dialog" aria-modal="true" aria-labelledby="module-save-title">
            <h2 id="module-save-title">Confirm module updates</h2>
            <p>The following updates will be applied when you confirm.</p>
            <div className="module-save-summary">
              <span className="module-save-metric module-save-metric-add">
                <strong>{moduleDraftDiff.addedLineCount} lines <span className="module-save-metric-separator">·</span> {moduleDraftDiff.addedMoveCount} moves</strong>
                <span>added</span>
              </span>
              <span className="module-save-metric module-save-metric-delete">
                <strong>{moduleDraftDiff.deletedLineCount} lines <span className="module-save-metric-separator">·</span> {moduleDraftDiff.deletedMoveCount} moves</strong>
                <span>deleted</span>
              </span>
            </div>
            <details className="module-save-details">
              <summary>Show update list</summary>
              {(['add', 'delete'] as const).map((kind) => {
                const updates = moduleDraftDiff.lines.filter((update) => update.kind === kind)
                if (updates.length === 0) return null
                return <section className="module-save-line-group" key={kind}>
                  <h3>{kind === 'add' ? 'Added lines' : 'Deleted lines'}</h3>
                  <ul>
                    {updates.map((update) => (
                      <li key={`line-${update.kind}-${update.line.id}`}>
                        {update.line.steps.map((step, ply) => (
                          <span key={`${step.uci}-${ply}`} className={ply >= update.changedFromPly ? `module-update-${update.kind}` : undefined}>
                            {ply > 0 ? ' ' : ''}{ply % 2 === 0 ? `${Math.floor(ply / 2) + 1}. ${step.san}` : step.san}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                </section>
              })}
            </details>
            <div className="module-save-actions">
              <button type="button" className="module-save-discard" onClick={() => { setModuleSaveConfirmOpen(false); discardModuleChanges() }}>Discard edits</button>
              <button type="button" onClick={() => setModuleSaveConfirmOpen(false)}>Keep editing</button>
              <button type="button" onClick={() => void saveModuleChanges()}>Confirm save</button>
            </div>
          </section>
        </div>
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
            playMoveSound={playMoveSound}
            playDrillCompleteSound={playDrillCompleteSound}
            playWrongMoveSound={playWrongMoveSound}
            lichessToken={token}
            user={auth.user}
            repertoireId={repertoire.repertoireIds[boardColor] ?? null}
            repertoireIds={moduleDrill ? [moduleDrill.module.id] : repertoire.activeProfile?.modules
              .filter((module) => module.enabled && module.color === boardColor)
              .map((module) => module.id)}
            templateReleaseIds={[]}
            drillLines={moduleDrill?.module.color === boardColor ? moduleDrill.lines : repertoire.drillLines[boardColor]}
            startContext={drillStartContext}
            startMode={drillStartMode}
            onStartAtSelectedPosition={selectCurrentDrillStartPosition}
            onStartFromBeginning={() => setDrillStartMode('beginning')}
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
            data-guide="moves"
            className={`panel moves-panel mobile-section-panel ${mobileExplorerSection === 'moves' ? 'mobile-active' : ''}`}
            role="tabpanel"
          >
            <h2>Moves</h2>
            <MoveList
              moves={moves}
              pointer={pointer}
              currentFen={fen}
              onSelect={goTo}
              boardColor={tutorialActive ? 'white' : boardColor}
              isPlySaved={isPlySaved}
              getPlySaveState={getPlySaveState}
              onTogglePlySaved={onTogglePlySaved}
              canEditModule={moduleWorkspaceMode === 'editing'}
              expandAllContinuations={tutorialActive}
              getContinuations={coverageContinuations}
              onPlayContinuationPath={playRepertoirePath}
            />
          </section>

          <div className="board-column" data-guide="board">
            <div className="board-heading">
              <OpeningName
                name={resolvedOpening?.opening.name ?? null}
                fen={fen}
                loading={openingExplorer.loading || ancestorOpeningLoading}
              />
            </div>
            <div className="board-with-eval" data-guide="explorer-board">
              <div className={`board-wrapper${isHistoryCaptureTransition ? ' history-capture-transition' : ''}`} data-active-piece-color={sideToMove(fen)}>
                <Chessboard
                  options={{
                    position: fen,
                    boardOrientation: boardColor,
                    canDragPiece: ({ piece }) => pieceMatchesColor(piece, sideToMove(fen)),
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
                    // react-chessboard cannot reliably infer the identity of a
                    // piece restored by undoing a capture and may slide it in
                    // from an unrelated square. Restore that snapshot cleanly.
                    showAnimations: !isUndoCaptureTransition,
                    animationDurationInMs: isHistoryCaptureTransition ? 400 : 420,
                    id: 'opening-prep-explorer-board',
                  }}
                />
              </div>
              <EvalBar evaluation={evaluation} boardColor={boardColor} />
            </div>
            <div className="board-controls explorer-board-controls">
              <button type="button" onClick={goBack} disabled={pointer === 0} title="Back (left arrow key)" aria-label="Back">
                <span className="desktop-control-label">← Back</span>
                <svg className="mobile-control-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12H4M10 6l-6 6 6 6" /></svg>
              </button>
              <button
                type="button"
                onClick={goForward}
                disabled={pointer === moves.length}
                title="Forward (right arrow key)"
                aria-label="Forward"
              >
                <span className="desktop-control-label">Forward →</span>
                <svg className="mobile-control-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M14 6l6 6-6 6" /></svg>
              </button>
              <button type="button" onClick={reset} disabled={moves.length === 0 && fen === START_FEN} title="Reset (R)" aria-label="Reset">
                <span className="desktop-control-label">Reset</span>
                <span className="mobile-reset-symbol" aria-hidden="true">↻</span>
              </button>
              <button
                type="button"
                onClick={startDrillFromPosition}
                disabled={!selectedModuleHasDrillContinuation}
                title={!selectedModuleHasDrillContinuation ? 'The selected module has no moves after this position' : undefined}
              >
                Drill from here
              </button>
            </div>
            <EngineEvalPanel evaluation={evaluation} />
          </div>

          <div className={`side-column ${mobileExplorerSection !== 'stats' ? 'mobile-section-container-hidden' : ''}`}>
            <section
              id="mobile-stats-panel"
              data-guide="stats"
              className={`panel explorer-panel mobile-section-panel ${mobileExplorerSection === 'stats' ? 'mobile-active' : ''}`}
              role="tabpanel"
            >
              <h2>{displayedExplorerSource === 'my-games' ? 'My games explorer' : 'Lichess explorer'}</h2>
              <div className="explorer-toolbar">
                <ExplorerSourceToggle source={displayedExplorerSource} onChange={setExplorerSource} />
                <ExplorerFiltersPanel
                  source={displayedExplorerSource}
                  filters={explorerFilters}
                  onChange={setExplorerFilters}
                />
              </div>
              <ExplorerStatsTable
                data={tutorialActive ? tutorialDisplayedStats : explorer.data}
                loading={tutorialActive ? false : explorer.loading}
                error={tutorialActive ? null : explorer.error}
                onMoveClick={(san) => playMove(san)}
                isMoveSaved={tutorialActive
                  ? (uci) => (TUTORIAL_VIENNA_TREE[normalizeFen(fen)] ?? []).some((move) => move.uci === uci)
                  : isExplorerMoveSaved}
                isMyMove={tutorialActive ? sideToMove(fen) === 'white' : isExplorerMyMove}
                isPolling={explorer.isPolling}
                pollExhausted={explorer.pollExhausted}
                onRetry={explorer.retry}
                showFullGameCounts={displayedExplorerSource === 'my-games'}
                accountActionHref={(isSignedIn ? lichessLoginUrl : googleLoginUrl)(window.location.pathname + window.location.search + window.location.hash)}
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
            data-guide="prep"
            className={`explorer-prep-tools ${mobileExplorerSection !== 'prep' ? 'mobile-section-container-hidden' : ''}`}
            role="tabpanel"
          >
            <section className="panel" data-guide="coverage">
              <CoverageDashboard
                color={boardColor}
                tree={moduleWorkspaceTree}
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
                getTree={() => moduleWorkspaceTree}
                getEditingTree={() => moduleWorkspaceTree}
                getLines={(color) => repertoire.editingLines[color] ?? []}
                isMoveSaved={(_color, positionFen, uci) => (moduleWorkspaceTree[normalizeFen(positionFen)] ?? []).some((move) => move.uci === uci)}
                addLine={addLineToModuleDraft}
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
