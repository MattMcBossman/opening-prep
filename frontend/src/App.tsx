import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Chessboard } from 'react-chessboard'
import type { PieceDropHandlerArgs, SquareHandlerArgs } from 'react-chessboard'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import { useGame, START_FEN } from './hooks/useGame'
import type { MoveInput } from './hooks/useGame'
import { useExplorerStats } from './hooks/useExplorerStats'
import { useEngineEval } from './hooks/useEngineEval'
import { useLichessToken } from './hooks/useLichessToken'
import { useTheme } from './hooks/useTheme'
import { useBoardColor } from './hooks/useBoardColor'
import { useHistoryKeyboardNav } from './hooks/useHistoryKeyboardNav'
import { useRepertoire } from './hooks/useRepertoire'
import { useSound } from './hooks/useSound'
import { MoveList } from './components/MoveList'
import { ExplorerStatsTable } from './components/ExplorerStatsTable'
import { EngineEvalPanel } from './components/EngineEvalPanel'
import { EvalBar } from './components/EvalBar'
import { OpeningName } from './components/OpeningName'
import { LichessTokenSettings } from './components/LichessTokenSettings'
import { ThemeToggle } from './components/ThemeToggle'
import { SoundToggle } from './components/SoundToggle'
import { BoardColorToggle } from './components/BoardColorToggle'
import { ModeToggle } from './components/ModeToggle'
import type { AppMode } from './components/ModeToggle'
import { DrillView } from './components/DrillView'
import { normalizeFen, originFenForPly, sideToMove } from './lib/chessUtils'
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
  const { fen, moves, pointer, goTo, goBack, goForward, makeMove, reset } = useGame()
  const { theme, toggleTheme } = useTheme()
  const { boardColor, toggleBoardColor } = useBoardColor()
  const { token, setToken } = useLichessToken()
  const explorer = useExplorerStats(fen, token)
  const evaluation = useEngineEval(fen)
  const repertoire = useRepertoire()
  const { soundEnabled, toggleSound, playMoveSound, playDrillCompleteSound } = useSound()
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null)
  const [mode, setMode] = useState<AppMode>('explorer')

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
      for (let i = index; i >= 0; i -= 1) {
        const ancestor = moves[i]
        if (!ancestor) break
        const ancestorOriginFen = originFenForPly(moves, i)
        repertoire.addMove(boardColor, ancestorOriginFen, {
          san: ancestor.san,
          uci: ancestor.uci,
          resultingFen: normalizeFen(ancestor.fenAfter),
        })
      }
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

  const playRepertoireMove = useCallback((move: RepertoireMove) => playMove(move.san), [playMove])
  const removeRepertoireMove = useCallback(
    (move: RepertoireMove) => repertoire.removeMove(boardColor, fen, move.uci),
    [repertoire, boardColor, fen],
  )

  const isExplorerMoveSaved = useCallback(
    (uci: string) => repertoire.isMoveSaved(boardColor, fen, uci),
    [repertoire, boardColor, fen],
  )

  // The explorer always lists candidate moves for whoever is to move at the current
  // position, so this is either "my" turn or the opponent's for every row at once -
  // used to pick the saved-move badge glyph (star for mine, checkmark for theirs).
  const isExplorerMyMove = sideToMove(fen) === boardColor

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
        <ModeToggle mode={mode} onChange={setMode} />
        <div className="header-controls">
          <SoundToggle soundEnabled={soundEnabled} onToggle={toggleSound} />
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </header>
      {mode === 'drill' ? (
        <DrillView
          repertoire={repertoire}
          color={boardColor}
          onToggleColor={handleToggleBoardColor}
          playMoveSound={playMoveSound}
          playDrillCompleteSound={playDrillCompleteSound}
          lichessToken={token}
        />
      ) : (
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
              <button type="button" onClick={reset} disabled={moves.length === 0}>
                Reset
              </button>
            </div>
            <EngineEvalPanel evaluation={evaluation} />
          </div>

          <div className="side-column">
            <section className="panel explorer-panel">
              <h2>Lichess explorer</h2>
              <LichessTokenSettings token={token} onChange={setToken} />
              <ExplorerStatsTable
                data={explorer.data}
                loading={explorer.loading}
                error={explorer.error}
                onMoveClick={(san) => playMove(san)}
                isMoveSaved={isExplorerMoveSaved}
                isMyMove={isExplorerMyMove}
              />
            </section>
          </div>
        </main>
      )}
    </div>
  )
}

export default App
