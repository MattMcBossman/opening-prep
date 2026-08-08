import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Chessboard } from 'react-chessboard'
import type { PieceDropHandlerArgs, SquareHandlerArgs } from 'react-chessboard'
import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import { useGame } from './hooks/useGame'
import { useExplorerStats } from './hooks/useExplorerStats'
import { useEngineEval } from './hooks/useEngineEval'
import { useLichessToken } from './hooks/useLichessToken'
import { MoveList } from './components/MoveList'
import { ExplorerStatsTable } from './components/ExplorerStatsTable'
import { EngineEvalPanel } from './components/EngineEvalPanel'
import { OpeningName } from './components/OpeningName'
import { LichessTokenSettings } from './components/LichessTokenSettings'
import './App.css'

const SELECTED_SQUARE_STYLE: CSSProperties = { backgroundColor: 'rgba(255, 235, 59, 0.5)' }
// Quiet moves get a small center dot.
const LEGAL_TARGET_STYLE: CSSProperties = {
  backgroundImage: 'radial-gradient(circle, rgba(0, 0, 0, 0.3) 22%, transparent 24%)',
}
// Captures (and en passant) target an occupied square, where a center dot would be
// hidden behind the piece artwork, so use an inset ring around the square instead.
const CAPTURE_TARGET_STYLE: CSSProperties = {
  boxShadow: 'inset 0 0 0 4px rgba(0, 0, 0, 0.35)',
}

function App() {
  const { fen, moves, pointer, goTo, goBack, goForward, makeMove, reset } = useGame()
  const { token, setToken } = useLichessToken()
  const explorer = useExplorerStats(fen, token)
  const evaluation = useEngineEval(fen)
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null)

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
        ...(move.isCapture() ? CAPTURE_TARGET_STYLE : LEGAL_TARGET_STYLE),
      }
    }
    return styles
  }, [selectedSquare, legalMoves])

  function handlePieceDrop({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean {
    if (!targetSquare) return false
    return makeMove({ from: sourceSquare, to: targetSquare, promotion: 'q' })
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
    const moved = makeMove({ from: selectedSquare, to: square, promotion: 'q' })
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
        <p>Opening explorer (Phase 1 MVP)</p>
      </header>
      <main className="explorer-layout">
        <div className="board-column">
          <OpeningName
            eco={explorer.data?.opening?.eco ?? null}
            name={explorer.data?.opening?.name ?? null}
            fen={fen}
          />
          <div className="board-wrapper">
            <Chessboard
              options={{
                position: fen,
                onPieceDrop: handlePieceDrop,
                onSquareClick: handleSquareClick,
                squareStyles,
                id: 'opening-prep-explorer-board',
              }}
            />
          </div>
          <div className="board-controls">
            <button type="button" onClick={goBack} disabled={pointer === 0}>
              ← Back
            </button>
            <button type="button" onClick={goForward} disabled={pointer === moves.length}>
              Forward →
            </button>
            <button type="button" onClick={reset} disabled={moves.length === 0}>
              Reset
            </button>
          </div>
          <EngineEvalPanel evaluation={evaluation} />
        </div>

        <div className="side-column">
          <section className="panel">
            <h2>Moves</h2>
            <MoveList moves={moves} pointer={pointer} onSelect={goTo} />
          </section>

          <section className="panel">
            <h2>Lichess explorer</h2>
            <LichessTokenSettings token={token} onChange={setToken} />
            <ExplorerStatsTable
              data={explorer.data}
              loading={explorer.loading}
              error={explorer.error}
              onMoveClick={(san) => makeMove(san)}
            />
          </section>
        </div>
      </main>
    </div>
  )
}

export default App
