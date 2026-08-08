import { describe, expect, it } from 'vitest'
import { collectDrillLines } from './repertoireDrills'
import { normalizeFen } from './chessUtils'
import { START_FEN } from '../hooks/useGame'
import {
  acknowledgeLineCompletion,
  advanceAutoPlay,
  applyMoveClassification,
  attemptOwnMove,
  createDrillSession,
  currentTargetLine,
  isSessionComplete,
  pendingAutoPlayStep,
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

/**
 * Plays one of the drilling color's own moves, then applies any opponent reply
 * it triggers - own move and opponent reply are now separate single-ply state
 * transitions (see `advanceAutoPlay`), so tests that aren't specifically about
 * that split use this to read as one logical ply, like the pre-split behavior.
 */
function playOwnMoveAndAutoReply(
  state: DrillSessionState,
  getContinuations: (fen: string) => RepertoireMove[],
  move: { uci: string; san: string; resultingFen: string },
): DrillSessionState {
  let next = attemptOwnMove(state, getContinuations, move)
  while (pendingAutoPlayStep(next)) {
    next = advanceAutoPlay(next)
  }
  return next
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

    state = playOwnMoveAndAutoReply(state, getContinuations, { uci: 'e2e4', san: 'e4', resultingFen: AFTER_E4 })
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

    state = playOwnMoveAndAutoReply(state, getContinuations, { uci: 'e2e4', san: 'e4', resultingFen: AFTER_E4 })
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

describe('drillSessionLogic - single-ply auto-play (lastAppliedSteps)', () => {
  const AFTER_NF3 = 'fen-after-2-Nf3 b - -'
  const tree: RepertoireTree = {
    [ROOT]: [{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }],
    [AFTER_E4]: [{ san: 'e5', uci: 'e7e5', resultingFen: AFTER_E4_E5 }],
    [AFTER_E4_E5]: [{ san: 'Nf3', uci: 'g1f3', resultingFen: AFTER_NF3 }],
  }
  const getContinuations = continuationsFrom(tree)

  it('reports the accepted own move immediately, and the opponent reply as its own separate step', () => {
    const lines = collectDrillLines('white', getContinuations)
    let state = createDrillSession(lines, ROOT)

    state = attemptOwnMove(state, getContinuations, { uci: 'e2e4', san: 'e4', resultingFen: AFTER_E4 })
    // Only the own move has landed on the board so far - the opponent's reply is
    // queued (see pendingAutoPlayStep) but deliberately not applied in this same
    // call, so the UI can animate the two plies separately instead of jumping both
    // at once (see the module doc on `applyStep` in drillSessionLogic.ts).
    expect(state.lastAppliedSteps.map((s) => s.san)).toEqual(['e4'])
    expect(pendingAutoPlayStep(state)?.san).toBe('e5')
    expect(state.currentFen).toBe(AFTER_E4)

    state = advanceAutoPlay(state)
    expect(state.lastAppliedSteps.map((s) => s.san)).toEqual(['e5'])
    expect(pendingAutoPlayStep(state)).toBeNull()
  })

  it('still reports the move that completed a line, after playedSteps has been reset', () => {
    const lines = collectDrillLines('white', getContinuations)
    let state = createDrillSession(lines, ROOT)

    state = playOwnMoveAndAutoReply(state, getContinuations, { uci: 'e2e4', san: 'e4', resultingFen: AFTER_E4 })
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

  it('advanceAutoPlay is a no-op when no opponent reply is pending', () => {
    const lines = collectDrillLines('white', getContinuations)
    const state = createDrillSession(lines, ROOT)
    expect(advanceAutoPlay(state)).toBe(state)
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

  it('tracks originPly so a later best-response line can be numbered correctly', () => {
    const AFTER_NF3 = 'fen-after-2-Nf3 b - -'
    const deeperTree: RepertoireTree = {
      [ROOT]: [{ san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 }],
      [AFTER_E4]: [{ san: 'e5', uci: 'e7e5', resultingFen: AFTER_E4_E5 }],
      [AFTER_E4_E5]: [{ san: 'Nf3', uci: 'g1f3', resultingFen: AFTER_NF3 }],
    }
    const deeperContinuations = continuationsFrom(deeperTree)
    const lines = collectDrillLines('white', deeperContinuations)
    let state = createDrillSession(lines, ROOT)

    // A wrong move right at the start (0 plies played yet).
    state = attemptOwnMove(state, deeperContinuations, { uci: 'd2d4', san: 'd4', resultingFen: 'x' })
    expect(state.lastFeedback).toMatchObject({ kind: 'wrong', originPly: 0 })

    // Play on, then a wrong move 2 plies in (after e4 and its auto-played e5 reply).
    state = playOwnMoveAndAutoReply(state, deeperContinuations, { uci: 'e2e4', san: 'e4', resultingFen: AFTER_E4 })
    state = attemptOwnMove(state, deeperContinuations, { uci: 'd2d4', san: 'd4', resultingFen: 'x' })
    expect(state.lastFeedback).toMatchObject({ kind: 'wrong', originPly: 2 })
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
    state = playOwnMoveAndAutoReply(state, getContinuations, { uci: 'e2e4', san: 'e4', resultingFen: AFTER_E4 })
    state = playOwnMoveAndAutoReply(state, getContinuations, { uci: 'g1f3', san: 'Nf3', resultingFen: AFTER_NF3 })

    // Play whichever of Bb5/Bc4 was NOT targeted, to force a redirect.
    const targetedFinal = currentTargetLine(state)
    const targetedMove = targetedFinal?.steps[targetedFinal.steps.length - 1]
    const alternate = targetedMove?.san === 'Bb5' ? { uci: 'f1c4', san: 'Bc4', resultingFen: AFTER_BC4 } : { uci: 'f1b5', san: 'Bb5', resultingFen: AFTER_BB5 }

    state = playOwnMoveAndAutoReply(state, getContinuations, alternate)
    expect(state.lastFeedback).toEqual({ kind: 'correct' })
    // Redirecting completed exactly one line (not a failure), leaving the other still pending.
    expect(sessionProgress(state)).toMatchObject({ pendingCount: 1, perfectCount: 1, failedCount: 0 })
    // The session pauses after every completed line - move past it before continuing.
    expect(state.completionPause).not.toBeNull()
    state = acknowledgeLineCompletion(state)

    // Finishing the session by completing the remaining (originally targeted) line.
    state = playOwnMoveAndAutoReply(state, getContinuations, { uci: 'e2e4', san: 'e4', resultingFen: AFTER_E4 })
    state = playOwnMoveAndAutoReply(state, getContinuations, { uci: 'g1f3', san: 'Nf3', resultingFen: AFTER_NF3 })
    state = playOwnMoveAndAutoReply(state, getContinuations, {
      uci: targetedMove!.uci,
      san: targetedMove!.san,
      resultingFen: targetedMove!.resultingFen,
    })
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
    state = playOwnMoveAndAutoReply(state, getContinuations, { uci: 'e2e4', san: 'e4', resultingFen: AFTER_E4 })
    state = playOwnMoveAndAutoReply(state, getContinuations, { uci: 'g1f3', san: 'Nf3', resultingFen: AFTER_NF3 })
    return state
  }

  it('rejects a saved move whose branch is already fully drilled, without penalizing the attempt', () => {
    const lines = collectDrillLines('white', getContinuations)
    let state = createDrillSession(lines, ROOT)

    // Complete the Bb5 branch fully first.
    state = playSharedPrefix(state)
    state = playOwnMoveAndAutoReply(state, getContinuations, { uci: 'f1b5', san: 'Bb5', resultingFen: AFTER_BB5 })
    expect(sessionProgress(state)).toMatchObject({ pendingCount: 1, perfectCount: 1 })
    state = acknowledgeLineCompletion(state)

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
    state = playOwnMoveAndAutoReply(state, getContinuations, { uci: 'f1c4', san: 'Bc4', resultingFen: AFTER_BC4 })
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
      state = playOwnMoveAndAutoReply(state, getContinuations, { uci: 'e2e4', san: 'e4', resultingFen: AFTER_E4 })
      // Each e4 completes a line on its own (the opponent's reply is the leaf) -
      // move past the pause so the next iteration's currentTargetLine reflects
      // whichever line is still pending, not the one just finished.
      state = acknowledgeLineCompletion(state)
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
    state = playOwnMoveAndAutoReply(state, getContinuations, {
      uci: firstMove!.uci,
      san: firstMove!.san,
      resultingFen: firstMove!.resultingFen,
    })
    state = acknowledgeLineCompletion(state)

    // Second line: get it right immediately (-> perfect).
    const secondMove = currentTargetLine(state)!.steps[0]
    state = playOwnMoveAndAutoReply(state, getContinuations, {
      uci: secondMove.uci,
      san: secondMove.san,
      resultingFen: secondMove.resultingFen,
    })

    expect(isSessionComplete(state)).toBe(true)
    expect(sessionProgress(state)).toMatchObject({ perfectCount: 1, failedCount: 1 })
    state = acknowledgeLineCompletion(state)

    state = retryFailedLines(state)
    expect(isSessionComplete(state)).toBe(false)
    expect(sessionProgress(state)).toMatchObject({
      pendingCount: 1,
      perfectCount: 0,
      failedCount: 0,
      totalLines: 1,
      isRetryPass: true,
      currentDrillNumber: 1,
    })
  })
})

describe('drillSessionLogic - completion pause', () => {
  const AFTER_NF3 = 'fen-after-2-Nf3 b - -'
  const tree: RepertoireTree = {
    [ROOT]: [
      { san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 },
      { san: 'd4', uci: 'd2d4', resultingFen: AFTER_D4 },
    ],
    [AFTER_E4]: [{ san: 'e5', uci: 'e7e5', resultingFen: AFTER_E4_E5 }],
    [AFTER_E4_E5]: [{ san: 'Nf3', uci: 'g1f3', resultingFen: AFTER_NF3 }],
    [AFTER_D4]: [{ san: 'd5', uci: 'd7d5', resultingFen: AFTER_D4_D5 }],
  }
  const getContinuations = continuationsFrom(tree)

  it('pauses at the true leaf position after completing a line, blocking further attempts until acknowledged', () => {
    const lines = collectDrillLines('white', getContinuations)
    let state = createDrillSession(lines, ROOT, lines.map((l) => l.id))

    state = attemptOwnMove(state, getContinuations, { uci: 'e2e4', san: 'e4', resultingFen: AFTER_E4 })
    // The opponent's reply is queued but not yet applied - own-move attempts are
    // blocked meanwhile, same as during the post-completion review pause.
    expect(wouldAcceptOwnMove(state, getContinuations, 'g1f3')).toBe(false)
    const beforeAutoPlay = state
    state = attemptOwnMove(state, getContinuations, { uci: 'g1f3', san: 'Nf3', resultingFen: AFTER_NF3 })
    expect(state).toBe(beforeAutoPlay)

    state = advanceAutoPlay(state)
    state = attemptOwnMove(state, getContinuations, { uci: 'g1f3', san: 'Nf3', resultingFen: AFTER_NF3 })
    // Three plies played (e4, e5, Nf3) to reach the leaf.
    expect(state.completionPause).toEqual({ lineId: expect.any(String), leafFen: AFTER_NF3, leafPly: 3 })
    expect(state.currentFen).toBe(AFTER_NF3) // the true leaf, not a stale pre-move position

    // Further attempts are ignored while paused for review.
    const beforeIgnoredAttempt = state
    state = attemptOwnMove(state, getContinuations, { uci: 'd2d4', san: 'd4', resultingFen: AFTER_D4 })
    expect(state).toBe(beforeIgnoredAttempt)

    state = acknowledgeLineCompletion(state)
    expect(state.completionPause).toBeNull()
    expect(state.currentFen).toBe(ROOT)
    expect(isSessionComplete(state)).toBe(false)
  })

  it('reports "Drill X of Y" progress that only advances once the pause is acknowledged', () => {
    const lines = collectDrillLines('white', getContinuations)
    let state = createDrillSession(lines, ROOT, lines.map((l) => l.id))
    expect(sessionProgress(state)).toMatchObject({ currentDrillNumber: 1, totalLines: 2, isRetryPass: false })

    state = playOwnMoveAndAutoReply(state, getContinuations, { uci: 'e2e4', san: 'e4', resultingFen: AFTER_E4 })
    state = attemptOwnMove(state, getContinuations, { uci: 'g1f3', san: 'Nf3', resultingFen: AFTER_NF3 })
    // Still "drill 1 of 2" while paused reviewing the line that was just finished.
    expect(sessionProgress(state)).toMatchObject({ currentDrillNumber: 1, totalLines: 2 })

    state = acknowledgeLineCompletion(state)
    expect(sessionProgress(state)).toMatchObject({ currentDrillNumber: 2, totalLines: 2 })
  })
})

describe('drillSessionLogic - default ordering is shuffled but complete', () => {
  const AFTER_C4 = 'fen-after-1-c4 b - -'
  const AFTER_C4_C5 = 'fen-after-1-c4-c5 w - -'
  const tree: RepertoireTree = {
    [ROOT]: [
      { san: 'e4', uci: 'e2e4', resultingFen: AFTER_E4 },
      { san: 'd4', uci: 'd2d4', resultingFen: AFTER_D4 },
      { san: 'c4', uci: 'c2c4', resultingFen: AFTER_C4 },
    ],
    [AFTER_E4]: [{ san: 'e5', uci: 'e7e5', resultingFen: AFTER_E4_E5 }],
    [AFTER_D4]: [{ san: 'd5', uci: 'd7d5', resultingFen: AFTER_D4_D5 }],
    [AFTER_C4]: [{ san: 'c5', uci: 'c7c5', resultingFen: AFTER_C4_C5 }],
  }
  const getContinuations = continuationsFrom(tree)

  it('createDrillSession without an explicit order still includes every line exactly once', () => {
    const lines = collectDrillLines('white', getContinuations)
    const state = createDrillSession(lines, ROOT)
    expect(new Set(state.order)).toEqual(new Set(lines.map((l) => l.id)))
    expect(state.order).toHaveLength(lines.length)
    expect(state.pendingIds.size).toBe(lines.length)
  })

  it('retryFailedLines reshuffles order while keeping every id present', () => {
    const lines = collectDrillLines('white', getContinuations)
    let state = createDrillSession(lines, ROOT, lines.map((l) => l.id))

    // Fail all three lines (wrong attempt, then the correct move each time).
    for (let i = 0; i < lines.length; i++) {
      const target = currentTargetLine(state)!
      state = attemptOwnMove(state, getContinuations, { uci: 'g1f3', san: 'Nf3', resultingFen: 'x' })
      state = playOwnMoveAndAutoReply(state, getContinuations, {
        uci: target.steps[0].uci,
        san: target.steps[0].san,
        resultingFen: target.steps[0].resultingFen,
      })
      state = acknowledgeLineCompletion(state)
    }
    expect(sessionProgress(state)).toMatchObject({ failedCount: 3, perfectCount: 0 })

    state = retryFailedLines(state)
    expect(new Set(state.order)).toEqual(new Set(lines.map((l) => l.id)))
    expect(sessionProgress(state)).toMatchObject({ pendingCount: 3, totalLines: 3, isRetryPass: true })
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
