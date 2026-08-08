import type { EngineEvaluation } from '../types'

// Copied from node_modules/stockfish/bin via `npm run setup:engine` (see scripts/copy-engine.mjs).
const ENGINE_URL = '/engine/stockfish-18-lite-single.js'

// Safety net: how long to wait for the engine to acknowledge a `stop` (via `bestmove`)
// before giving up and proceeding anyway. Real Stockfish acknowledges almost
// immediately; this only guards against an unexpected engine-side stall.
const STOP_ACK_TIMEOUT_MS = 2000

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
 *
 * Requests are serialized: per the UCI protocol, a new `position`/`go` shouldn't be sent
 * while a previous search is still active. When evaluate() is called again before the
 * previous search finished, this stops it and *waits for the engine to acknowledge the
 * stop* (its `bestmove` line) before starting the next search — sending `position`
 * immediately after `stop`, without waiting for that acknowledgment, is what let a new
 * search silently never produce output (the "stuck on Starting engine…" bug).
 */
export class StockfishEngine {
  private worker: Worker
  private ready: Promise<void>
  private readyResolve: (() => void) | null = null
  private terminated = false
  // Bumped on every evaluate() call and on terminate(). Lets us detect and ignore a
  // request that's been superseded by a newer one while it was waiting its turn.
  private requestId = 0
  private searching = false
  private stopWaiters: Array<() => void> = []

  // Describes the request currently "owning" the engine's output, updated by evaluate().
  private currentFen = ''
  private currentMaxDepth = 20
  private currentOnUpdate: ((evaluation: EngineEvaluation) => void) | null = null
  private lastInfo: Omit<EngineEvaluation, 'fen' | 'thinking'> | null = null

  constructor() {
    this.worker = new Worker(ENGINE_URL)
    this.worker.addEventListener('message', this.handleMessage)
    this.ready = this.initialize()
  }

  private initialize(): Promise<void> {
    return new Promise((resolve) => {
      this.readyResolve = resolve
      const onUciHandshake = (e: MessageEvent<string>) => {
        if (e.data === 'uciok') {
          this.worker.postMessage('isready')
        } else if (e.data === 'readyok') {
          this.worker.removeEventListener('message', onUciHandshake)
          resolve()
        }
      }
      this.worker.addEventListener('message', onUciHandshake)
      this.worker.postMessage('uci')
    })
  }

  // Single, permanent listener for the engine's lifetime — avoids add/removeEventListener
  // churn per request and centralizes "is a search currently running" bookkeeping.
  private handleMessage = (e: MessageEvent<string>) => {
    const line = e.data
    if (typeof line !== 'string') return

    if (line.startsWith('bestmove')) {
      this.searching = false
      const waiters = this.stopWaiters
      this.stopWaiters = []
      for (const resolve of waiters) resolve()

      if (this.currentOnUpdate) {
        const [, bestMoveUci] = line.split(' ')
        this.currentOnUpdate({
          fen: this.currentFen,
          depth: this.lastInfo?.depth ?? this.currentMaxDepth,
          scoreType: this.lastInfo?.scoreType ?? 'cp',
          scoreValue: this.lastInfo?.scoreValue ?? 0,
          bestMoveUci:
            bestMoveUci && bestMoveUci !== '(none)' ? bestMoveUci : this.lastInfo?.bestMoveUci ?? null,
          pvUci: this.lastInfo?.pvUci ?? [],
          thinking: false,
        })
      }
      return
    }

    if (line.startsWith('info depth') && this.currentOnUpdate) {
      const sideToMove = this.currentFen.split(' ')[1] === 'b' ? 'b' : 'w'
      const parsed = parseInfoLine(line, sideToMove)
      if (parsed) {
        this.lastInfo = parsed
        this.currentOnUpdate({ ...parsed, fen: this.currentFen, thinking: true })
      }
    }
  }

  /**
   * Starts evaluating `fen`, cancelling any evaluation previously started on this
   * instance. Returns a function that stops this evaluation early.
   */
  async evaluate(fen: string, { maxDepth = 20, onUpdate }: EvaluateOptions): Promise<() => void> {
    await this.ready
    if (this.terminated) return () => {}

    const requestId = ++this.requestId
    await this.stopAndWaitForIdle()
    if (this.terminated || requestId !== this.requestId) return () => {}

    this.currentFen = fen
    this.currentMaxDepth = maxDepth
    this.currentOnUpdate = onUpdate
    this.lastInfo = null
    this.searching = true

    this.worker.postMessage(`position fen ${fen}`)
    this.worker.postMessage(`go depth ${maxDepth}`)

    return () => {
      if (requestId === this.requestId) {
        this.stopCurrent()
      }
    }
  }

  /** Stops whatever is currently being reported, and waits until the engine is idle. */
  private stopAndWaitForIdle(): Promise<void> {
    this.stopCurrent()
    if (!this.searching) return Promise.resolve()

    return new Promise((resolve) => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        resolve()
      }
      this.stopWaiters.push(done)
      const timeoutId = setTimeout(done, STOP_ACK_TIMEOUT_MS)
    })
  }

  private stopCurrent() {
    this.currentOnUpdate = null
    if (this.searching) {
      this.worker.postMessage('stop')
    }
  }

  terminate() {
    this.terminated = true
    this.requestId++
    this.searching = false
    this.currentOnUpdate = null
    const waiters = this.stopWaiters
    this.stopWaiters = []
    for (const resolve of waiters) resolve()
    // Unblock any evaluate() call still awaiting startup so it can see `terminated`
    // and bail out instead of hanging forever.
    this.readyResolve?.()
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
