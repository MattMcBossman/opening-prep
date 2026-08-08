import type { EngineEvaluation } from '../types'

// Copied from node_modules/stockfish/bin via `npm run setup:engine` (see scripts/copy-engine.mjs).
const ENGINE_URL = '/engine/stockfish-18-lite-single.js'

type EvaluateOptions = {
  /** Deepest ply to search to. The engine emits progressively deeper `info` updates on the way there. */
  maxDepth?: number
  onUpdate: (evaluation: EngineEvaluation) => void
}

/**
 * Thin wrapper around the Stockfish WASM Web Worker, speaking the UCI protocol.
 *
 * Evaluation uses the engine's native iterative deepening: a single `go depth N`
 * command makes Stockfish search depth 1, 2, 3... up to N, emitting an `info depth`
 * line after each completed depth. `onUpdate` is called on every one of those lines,
 * so callers see a fast shallow result first and progressively deeper results as they
 * arrive, without needing to reissue commands.
 */
export class StockfishEngine {
  private worker: Worker
  private ready: Promise<void>
  private activeListener: ((e: MessageEvent<string>) => void) | null = null

  constructor() {
    this.worker = new Worker(ENGINE_URL)
    this.ready = this.initialize()
  }

  private initialize(): Promise<void> {
    return new Promise((resolve) => {
      const onMessage = (e: MessageEvent<string>) => {
        if (e.data === 'uciok') {
          this.worker.postMessage('isready')
        } else if (e.data === 'readyok') {
          this.worker.removeEventListener('message', onMessage)
          resolve()
        }
      }
      this.worker.addEventListener('message', onMessage)
      this.worker.postMessage('uci')
    })
  }

  /**
   * Starts evaluating `fen`, cancelling any evaluation previously started on this
   * instance. Returns a function that stops this evaluation early.
   */
  async evaluate(fen: string, { maxDepth = 20, onUpdate }: EvaluateOptions): Promise<() => void> {
    await this.ready
    this.cancelActive()

    const sideToMove = fen.split(' ')[1] === 'b' ? 'b' : 'w'
    let lastInfo: Omit<EngineEvaluation, 'fen' | 'thinking'> | null = null

    const listener = (e: MessageEvent<string>) => {
      const line = e.data
      if (typeof line !== 'string') return

      if (line.startsWith('info depth')) {
        const parsed = parseInfoLine(line, sideToMove)
        if (parsed) {
          lastInfo = parsed
          onUpdate({ ...parsed, fen, thinking: true })
        }
      } else if (line.startsWith('bestmove')) {
        const [, bestMoveUci] = line.split(' ')
        // `bestmove` carries no score of its own; reuse the last `info depth` line's
        // evaluation so the displayed score doesn't reset to 0 once the search finishes.
        onUpdate({
          fen,
          depth: lastInfo?.depth ?? maxDepth,
          scoreType: lastInfo?.scoreType ?? 'cp',
          scoreValue: lastInfo?.scoreValue ?? 0,
          bestMoveUci:
            bestMoveUci && bestMoveUci !== '(none)' ? bestMoveUci : lastInfo?.bestMoveUci ?? null,
          pvUci: lastInfo?.pvUci ?? [],
          thinking: false,
        })
      }
    }

    this.activeListener = listener
    this.worker.addEventListener('message', listener)
    this.worker.postMessage(`position fen ${fen}`)
    this.worker.postMessage(`go depth ${maxDepth}`)

    return () => {
      if (this.activeListener === listener) {
        this.cancelActive()
      }
    }
  }

  private cancelActive() {
    if (this.activeListener) {
      this.worker.removeEventListener('message', this.activeListener)
      this.activeListener = null
      this.worker.postMessage('stop')
    }
  }

  terminate() {
    this.cancelActive()
    this.worker.postMessage('quit')
    this.worker.terminate()
  }
}

function parseInfoLine(
  line: string,
  sideToMove: 'w' | 'b',
): Omit<EngineEvaluation, 'fen' | 'thinking'> | null {
  const depthMatch = line.match(/ depth (\d+)/)
  const scoreCpMatch = line.match(/score cp (-?\d+)/)
  const scoreMateMatch = line.match(/score mate (-?\d+)/)
  const pvMatch = line.match(/ pv (.+)$/)

  if (!depthMatch || (!scoreCpMatch && !scoreMateMatch)) return null

  const depth = parseInt(depthMatch[1], 10)
  const pvUci = pvMatch ? pvMatch[1].trim().split(' ') : []
  const bestMoveUci = pvUci[0] ?? null

  const scoreType: 'cp' | 'mate' = scoreMateMatch ? 'mate' : 'cp'
  let scoreValue = parseInt((scoreMateMatch ?? scoreCpMatch)![1], 10)

  // Stockfish reports scores from the perspective of the side to move; normalize to White's perspective.
  if (sideToMove === 'b') {
    scoreValue *= -1
  }

  return { depth, scoreType, scoreValue, bestMoveUci, pvUci }
}
