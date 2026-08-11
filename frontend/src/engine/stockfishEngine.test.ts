import { afterEach, describe, expect, it, vi } from 'vitest'
import { StockfishEngine } from './stockfishEngine'

class FakeWorker {
  static instance: FakeWorker
  messages: string[] = []
  listeners = new Set<(event: MessageEvent<string>) => void>()

  constructor() {
    FakeWorker.instance = this
  }

  addEventListener(_type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.add(listener as (event: MessageEvent<string>) => void)
  }

  removeEventListener(_type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.delete(listener as (event: MessageEvent<string>) => void)
  }

  postMessage(message: string) {
    this.messages.push(message)
    if (message === 'uci') queueMicrotask(() => this.emit('uciok'))
    if (message === 'isready') queueMicrotask(() => this.emit('readyok'))
  }

  terminate() {}

  emit(data: string) {
    for (const listener of this.listeners) listener(new MessageEvent('message', { data }))
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('StockfishEngine MultiPV', () => {
  it('collects ranked lines at bestmove and bounds their PV horizon', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const engine = new StockfishEngine()
    const onUpdate = vi.fn()
    const result = engine.evaluateMultiPvOnce(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      18,
      3,
      2,
      onUpdate,
    )
    await vi.waitFor(() => expect(FakeWorker.instance.messages).toContain('go depth 18'))

    FakeWorker.instance.emit('info depth 18 multipv 2 score cp 14 pv d2d4 d7d5 c2c4')
    FakeWorker.instance.emit('info depth 18 multipv 1 score cp 22 pv e2e4 e7e5 g1f3')
    FakeWorker.instance.emit('info depth 18 multipv 3 score cp 8 pv c2c4 e7e5 b1c3')
    expect(onUpdate).toHaveBeenCalledWith([
      { rank: 1, depth: 18, scoreType: 'cp', scoreValue: 22, bestMoveUci: 'e2e4', pvUci: ['e2e4', 'e7e5'] },
      { rank: 2, depth: 18, scoreType: 'cp', scoreValue: 14, bestMoveUci: 'd2d4', pvUci: ['d2d4', 'd7d5'] },
      { rank: 3, depth: 18, scoreType: 'cp', scoreValue: 8, bestMoveUci: 'c2c4', pvUci: ['c2c4', 'e7e5'] },
    ])
    FakeWorker.instance.emit('bestmove e2e4')

    await expect(result).resolves.toEqual([
      { rank: 1, depth: 18, scoreType: 'cp', scoreValue: 22, bestMoveUci: 'e2e4', pvUci: ['e2e4', 'e7e5'] },
      { rank: 2, depth: 18, scoreType: 'cp', scoreValue: 14, bestMoveUci: 'd2d4', pvUci: ['d2d4', 'd7d5'] },
      { rank: 3, depth: 18, scoreType: 'cp', scoreValue: 8, bestMoveUci: 'c2c4', pvUci: ['c2c4', 'e7e5'] },
    ])
    expect(FakeWorker.instance.messages).toContain('setoption name MultiPV value 1')
    engine.terminate()
  })
})
