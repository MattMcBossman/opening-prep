import { Chessboard } from 'react-chessboard'
import type { PieceDropHandlerArgs } from 'react-chessboard'
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

function App() {
  const { fen, moves, pointer, goTo, goBack, goForward, makeMove, reset } = useGame()
  const { token, setToken } = useLichessToken()
  const explorer = useExplorerStats(fen, token)
  const evaluation = useEngineEval(fen)

  function handlePieceDrop({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean {
    if (!targetSquare) return false
    return makeMove({ from: sourceSquare, to: targetSquare, promotion: 'q' })
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
