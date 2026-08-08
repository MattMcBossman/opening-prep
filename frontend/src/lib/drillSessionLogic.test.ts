import { describe, expect, it } from 'vitest'
import { collectDrillLines } from './repertoireDrills'
import { normalizeFen } from './chessUtils'
import { START_FEN } from '../hooks/useGame'
import {
  applyMoveClassification,
  attemptOwnMove,
  createDrillSession,
  currentTargetLine,
  isSessionComplete,
  retryFailedLines,
  sessionProgress,
  wouldAcceptOwnMove,
} from './drillSessionLogic'
import type { DrillSessionState } from './drillSessionLogic'
import type { RepertoireMove, RepertoireTree } from '../types'

const ROOT = normalizeFen(START_FEN)
const AFTER_E4 = 'fen-after-1-e4 b - -'
const AFTER_E4_E5 = 'fen-after-1-e4-e5 w - -'
const AFTER_D4 = 'fen-after-1-d4 b - -'
const AFTER_D4_D5 = 'fen-after-1-d4-d5 w - -'

function continuationsFrom(tree: RepertoireTree): (fen: string) => RepertoireMove[] {
  return (fen: string) => tree[normalizeFen(fen)] ?? []
}

describe('drillSessionLogic - single line', () => {
  const tree: RepertoireTree = {
    [ROOT]: [{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }],
    [AFTER_E4]: [{ san: 'e5', uci: 'e7e5', resultingFen: AFTER_E4_E5 }],
  }
  const getContinuations = continuationsFrom(tree)

  it('completes as perfect when every move played is correct', () => {
    const lines = collectDrillLines('white', getContinuations)
    let state = createDrillSession(lines, ROOT)
    expect(isSessionComplete(state)).toBe(false)

    state = attemptOwnMove(state, getContinuations, { uci: 'e2e4', san: 'e4', resultingFen: AFTER_E4 })
    expect(state.lastFeedback).toEqual({ kind: 'correct' })
    // The opponent's only saved reply (e5) auto-plays, reaching the leaf and completing the line.
    expect(isSessionComplete(state)).toBe(true)
    expect(sessionProgress(state)).toMatchObject({ totalLines: 1, pendingCount: 0, perfectCount: 1, failedCount: 0 })
  })

  it('marks a line failed if any wrong attempt occurred, even after eventually getting it right', () => {
    const lines = collectDrillLines('white', getContinuations)
    let state = createDrillSession(lines, ROOT)

    state = attemptOwnMove(state, getContinuations, { uci: 'g1f3', san: 'Nf3', resultingFen: 'irrelevant' })
    expect(state.lastFeedback?.kind).toBe('wrong')
    expect(isSessionComplete(state)).toBe(false) // still awaiting the correct move at the same position

    state = attemptOwnMove(state, getContinuations, { uci: 'e2e4', san: 'e4', resultingFen: AFTER_E4 })
    expect(isSessionComplete(state)).toBe(true)
    expect(sessionProgress(state)).toMatchObject({ perfectCount: 0, failedCount: 1 })
  })

  it('rejects a wrong move without ever completing the session on its own', () => {
    const lines = collectDrillLines('white', getContinuations)
    let state = createDrillSession(lines, ROOT)
    for (let i = 0; i < 5; i++) {
      state = attemptOwnMove(state, getContinuations, { uci: 'g1f3', san: 'Nf3', resultingFen: 'irrelevant' })
    }
    expect(isSessionComplete(state)).toBe(false)
    expect(state.wrongAttempts).toBe(5)
  })
})

describe('drillSessionLogic - lastAppliedSteps', () => {
  const AFTER_NF3 = 'fen-after-2-Nf3 b - -'
  const tree: RepertoireTree = {
    [ROOT]: [{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }],
    [AFTER_E4]: [{ san: 'e5', uci: 'e7e5', resultingFen: AFTER_E4_E5 }],
    [AFTER_E4_E5]: [{ san: 'Nf3', uci: 'g1f3', resultingFen: AFTER_NF3 }],
  }
  const getContinuations = continuationsFrom(tree)

  it('reports the accepted move plus the opponent reply auto-played after it', () => {
    const lines = collectDrillLines('white', getContinuations)
    let state = createDrillSession(lines, ROOT)

    state = attemptOwnMove(state, getContinuations, { uci: 'e2e4', san: 'e4', resultingFen: AFTER_E4 })
    expect(state.lastAppliedSteps.map((s) => s.san)).toEqual(['e4', 'e5'])
  })

  it('still reports the move that completed a line, after playedSteps has been reset', () => {
    const lines = collectDrillLines('white', getContinuations)
    let state = createDrillSession(lines, ROOT)

    state = attemptOwnMove(state, getContinuations, { uci: 'e2e4', san: 'e4', resultingFen: AFTER_E4 })
    state = attemptOwnMove(state, getContinuations, { uci: 'g1f3', san: 'Nf3', resultingFen: AFTER_NF3 })
    expect(isSessionComplete(state)).toBe(true)
    // The occurrence is over, so playedSteps is back to empty...
    expect(state.playedSteps).toEqual([])
    // ...but the finishing move is still reported, so callers can react to it.
    expect(state.lastAppliedSteps.map((s) => s.san)).toEqual(['Nf3'])
  })

  it('reports nothing for an attempt that never reaches the board', () => {
    const lines = collectDrillLines('white', getContinuations)
    let state = createDrillSession(lines, ROOT)

    state = attemptOwnMove(state, getContinuations, { uci: 'd2d4', san: 'd4', resultingFen: 'irrelevant' })
    expect(state.lastFeedback?.kind).toBe('wrong')
    expect(state.lastAppliedSteps).toEqual([])
  })
})

describe('drillSessionLogic - wrong-attempt hint progression', () => {
  const tree: RepertoireTree = {
    [ROOT]: [{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }],
  }
  const getContinuations = continuationsFrom(tree)

  it('reveals no square hints on the 1st attempt, origin on the 2nd, origin+destination on the 3rd', () => {
    const lines = collectDrillLines('white', getContinuations)
    let state = createDrillSession(lines, ROOT)
    const wrong = { uci: 'g1f3', san: 'Nf3', resultingFen: 'irrelevant' }

    state = attemptOwnMove(state, getContinuations, wrong)
    expect(state.lastFeedback).toMatchObject({ kind: 'wrong', attemptNumber: 1, hintFrom: undefined, hintTo: undefined })

    state = attemptOwnMove(state, getContinuations, wrong)
    expect(state.lastFeedback).toMatchObject({ kind: 'wrong', attemptNumber: 2, hintFrom: 'e2', hintTo: undefined })

    state = attemptOwnMove(state, getContinuations, wrong)
    expect(state.lastFeedback).toMatchObject({ kind: 'wrong', attemptNumber: 3, hintFrom: 'e2', hintTo: 'e4' })
  })
})

describe('drillSessionLogic - multiple own-move options', () => {
  const AFTER_NF3 = 'fen-after-2-Nf3 b - -'
  const AFTER_NC6 = 'fen-after-2...Nc6 w - -'
  const AFTER_BB5 = 'fen-after-3-Bb5 b - -'
  const AFTER_BC4 = 'fen-after-3-Bc4 b - -'

  const tree: RepertoireTree = {
    [ROOT]: [{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }],
    [AFTER_E4]: [{ san: 'e5', uci: 'e7e5', resultingFen: AFTER_E4_E5 }],
    [AFTER_E4_E5]: [{ san: 'Nf3', uci: 'g1f3', resultingFen: AFTER_NF3 }],
    [AFTER_NF3]: [{ san: 'Nc6', uci: 'b8c6', resultingFen: AFTER_NC6 }],
    [AFTER_NC6]: [
      { san: 'Bb5', uci: 'f1b5', resultingFen: AFTER_BB5 },
      { san: 'Bc4', uci: 'f1c4', resultingFen: AFTER_BC4 },
    ],
  }
  const getContinuations = continuationsFrom(tree)

  it('accepts whichever saved option is played and redirects rather than failing', () => {
    const lines = collectDrillLines('white', getContinuations)
    let state = createDrillSession(lines, ROOT)
    const targetedFirst = currentTargetLine(state)
    expect(targetedFirst).not.toBeNull()

    // Play the shared prefix.
    state = attemptOwnMove(state, getContinuations, { uci: 'e2e4', san: 'e4', resultingFen: AFTER_E4 })
    state = attemptOwnMove(state, getContinuations, { uci: 'g1f3', san: 'Nf3', resultingFen: AFTER_NF3 })

    // Play whichever of Bb5/Bc4 was NOT targeted, to force a redirect.
    const targetedFinal = currentTargetLine(state)
    const targetedMove = targetedFinal?.steps[targetedFinal.steps.length - 1]
    const alternate = targetedMove?.san === 'Bb5' ? { uci: 'f1c4', san: 'Bc4', resultingFen: AFTER_BC4 } : { uci: 'f1b5', san: 'Bb5', resultingFen: AFTER_BB5 }

    state = attemptOwnMove(state, getContinuations, alternate)
    expect(state.lastFeedback).toEqual({ kind: 'correct' })
    // Redirecting completed exactly one line (not a failure), leaving the other still pending.
    expect(sessionProgress(state)).toMatchObject({ pendingCount: 1, perfectCount: 1, failedCount: 0 })

    // Finishing the session by completing the remaining (originally targeted) line.
    state = attemptOwnMove(state, getContinuations, { uci: 'e2e4', san: 'e4', resultingFen: AFTER_E4 })
    state = attemptOwnMove(state, getContinuations, { uci: 'g1f3', san: 'Nf3', resultingFen: AFTER_NF3 })
    state = attemptOwnMove(state, getContinuations, { uci: targetedMove!.uci, san: targetedMove!.san, resultingFen: targetedMove!.resultingFen })
    expect(isSessionComplete(state)).toBe(true)
    expect(sessionProgress(state)).toMatchObject({ totalLines: 2, pendingCount: 0, perfectCount: 2, failedCount: 0 })
  })
})

describe('drillSessionLogic - rejecting an already-fully-drilled branch', () => {
  const AFTER_NF3 = 'fen-after-2-Nf3 b - -'
  const AFTER_NC6 = 'fen-after-2...Nc6 w - -'
  const AFTER_BB5 = 'fen-after-3-Bb5 b - -'
  const AFTER_BC4 = 'fen-after-3-Bc4 b - -'

  const tree: RepertoireTree = {
    [ROOT]: [{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }],
    [AFTER_E4]: [{ san: 'e5', uci: 'e7e5', resultingFen: AFTER_E4_E5 }],
    [AFTER_E4_E5]: [{ san: 'Nf3', uci: 'g1f3', resultingFen: AFTER_NF3 }],
    [AFTER_NF3]: [{ san: 'Nc6', uci: 'b8c6', resultingFen: AFTER_NC6 }],
    [AFTER_NC6]: [
      { san: 'Bb5', uci: 'f1b5', resultingFen: AFTER_BB5 },
      { san: 'Bc4', uci: 'f1c4', resultingFen: AFTER_BC4 },
    ],
  }
  const getContinuations = continuationsFrom(tree)

  function playSharedPrefix(state: DrillSessionState): DrillSessionState {
    state = attemptOwnMove(state, getContinuations, { uci: 'e2e4', san: 'e4', resultingFen: AFTER_E4 })
    state = attemptOwnMove(state, getContinuations, { uci: 'g1f3', san: 'Nf3', resultingFen: AFTER_NF3 })
    return state
  }

  it('rejects a saved move whose branch is already fully drilled, without penalizing the attempt', () => {
    const lines = collectDrillLines('white', getContinuations)
    let state = createDrillSession(lines, ROOT)

    // Complete the Bb5 branch fully first.
    state = playSharedPrefix(state)
    state = attemptOwnMove(state, getContinuations, { uci: 'f1b5', san: 'Bb5', resultingFen: AFTER_BB5 })
    expect(sessionProgress(state)).toMatchObject({ pendingCount: 1, perfectCount: 1 })

    // On the second (Bc4) occurrence, trying the now-fully-drilled Bb5 branch
    // should be rejected - not accepted, and not a wrong-move penalty.
    state = playSharedPrefix(state)
    expect(wouldAcceptOwnMove(state, getContinuations, 'f1b5')).toBe(false)
    state = attemptOwnMove(state, getContinuations, { uci: 'f1b5', san: 'Bb5', resultingFen: AFTER_BB5 })
    expect(state.lastFeedback).toEqual({ kind: 'alreadyDrilled', playedSan: 'Bb5', playedUci: 'f1b5' })
    expect(state.hasWrongAttemptThisOccurrence).toBe(false)
    expect(state.wrongAttempts).toBe(0)
    expect(isSessionComplete(state)).toBe(false) // still awaiting Bc4

    // The still-pending option is unaffected and completes the session perfectly.
    expect(wouldAcceptOwnMove(state, getContinuations, 'f1c4')).toBe(true)
    state = attemptOwnMove(state, getContinuations, { uci: 'f1c4', san: 'Bc4', resultingFen: AFTER_BC4 })
    expect(isSessionComplete(state)).toBe(true)
    expect(sessionProgress(state)).toMatchObject({ totalLines: 2, perfectCount: 2, failedCount: 0 })
  })
})

describe('drillSessionLogic - multiple opponent replies', () => {
  const AFTER_E4_C5 = 'fen-after-1-e4-c5 w - -'
  const tree: RepertoireTree = {
    [ROOT]: [{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }],
    [AFTER_E4]: [
      { san: 'e5', uci: 'e7e5', resultingFen: AFTER_E4_E5 },
      { san: 'c5', uci: 'c7c5', resultingFen: AFTER_E4_C5 },
    ],
  }
  const getContinuations = continuationsFrom(tree)

  it('auto-plays whichever opponent reply the current target line specifies, covering both across the session', () => {
    const lines = collectDrillLines('white', getContinuations)
    let state = createDrillSession(lines, ROOT)
    const seenReplies = new Set<string>()

    for (let i = 0; i < 2; i++) {
      const target = currentTargetLine(state)
      seenReplies.add(target!.steps[1].san)
      state = attemptOwnMove(state, getContinuations, { uci: 'e2e4', san: 'e4', resultingFen: AFTER_E4 })
    }

    expect(seenReplies).toEqual(new Set(['e5', 'c5']))
    expect(isSessionComplete(state)).toBe(true)
    expect(sessionProgress(state)).toMatchObject({ totalLines: 2, perfectCount: 2 })
  })
})

describe('drillSessionLogic - retryFailedLines', () => {
  const tree: RepertoireTree = {
    [ROOT]: [
      { san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 },
      { san: 'd4', uci: 'd2d4', resultingFen: AFTER_D4 },
    ],
    [AFTER_E4]: [{ san: 'e5', uci: 'e7e5', resultingFen: AFTER_E4_E5 }],
    [AFTER_D4]: [{ san: 'd5', uci: 'd7d5', resultingFen: AFTER_D4_D5 }],
  }
  const getContinuations = continuationsFrom(tree)

  it('requeues only the failed line(s), leaving perfect ones out', () => {
    const lines = collectDrillLines('white', getContinuations)
    let state = createDrillSession(lines, ROOT, lines.map((l) => l.id)) // deterministic order for the test

    // First line: get it wrong once, then right (-> failed).
    state = attemptOwnMove(state, getContinuations, { uci: 'g1f3', san: 'Nf3', resultingFen: 'x' })
    const firstMove = state.playedSteps.length === 0 ? currentTargetLine(state)!.steps[0] : undefined
    state = attemptOwnMove(state, getContinuations, {
      uci: firstMove!.uci,
      san: firstMove!.san,
      resultingFen: firstMove!.resultingFen,
    })

    // Second line: get it right immediately (-> perfect).
    const secondMove = currentTargetLine(state)!.steps[0]
    state = attemptOwnMove(state, getContinuations, {
      uci: secondMove.uci,
      san: secondMove.san,
      resultingFen: secondMove.resultingFen,
    })

    expect(isSessionComplete(state)).toBe(true)
    expect(sessionProgress(state)).toMatchObject({ perfectCount: 1, failedCount: 1 })

    state = retryFailedLines(state)
    expect(isSessionComplete(state)).toBe(false)
    expect(sessionProgress(state)).toMatchObject({ pendingCount: 1, perfectCount: 0, failedCount: 0 })
  })
})

describe('applyMoveClassification', () => {
  const tree: RepertoireTree = {
    [ROOT]: [{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }],
  }
  const getContinuations = continuationsFrom(tree)

  it('merges classification into the matching in-flight wrong-move feedback', () => {
    const lines = collectDrillLines('white', getContinuations)
    let state = createDrillSession(lines, ROOT)
    state = attemptOwnMove(state, getContinuations, { uci: 'g1f3', san: 'Nf3', resultingFen: 'x' })
    const token = state.lastFeedback?.kind === 'wrong' ? state.lastFeedback.attemptToken : -1

    const bestResponseLine = {
      fen: 'x',
      depth: 14,
      scoreType: 'cp' as const,
      scoreValue: -300,
      bestMoveUci: 'd8h4',
      pvUci: ['d8h4'],
      thinking: false,
    }
    state = applyMoveClassification(state, token, { cpLoss: 120, isBad: true, bestResponseLine })
    expect(state.lastFeedback).toMatchObject({ kind: 'wrong', cpLoss: 120, isBad: true })
  })

  it('ignores a stale classification for an attempt that is no longer current', () => {
    const lines = collectDrillLines('white', getContinuations)
    let state = createDrillSession(lines, ROOT)
    state = attemptOwnMove(state, getContinuations, { uci: 'g1f3', san: 'Nf3', resultingFen: 'x' })
    const staleToken = state.lastFeedback?.kind === 'wrong' ? state.lastFeedback.attemptToken : -1
    // A second wrong attempt supersedes the first's feedback.
    state = attemptOwnMove(state, getContinuations, { uci: 'g1f3', san: 'Nf3', resultingFen: 'x' })

    const bestResponseLine = {
      fen: 'x',
      depth: 14,
      scoreType: 'cp' as const,
      scoreValue: -300,
      bestMoveUci: 'd8h4',
      pvUci: ['d8h4'],
      thinking: false,
    }
    const before = state
    state = applyMoveClassification(state, staleToken, { cpLoss: 999, isBad: true, bestResponseLine })
    expect(state).toBe(before) // unchanged - the stale token didn't match the current attempt
  })
})
