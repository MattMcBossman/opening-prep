# Board and position comparison plan

## Objective

Turn the current vague “similar position elsewhere in your prep” drill hint into
evidence the user can act on. Comparisons must answer three questions quickly:

1. What is physically different on the board?
2. Do side-to-move, castling, or en-passant rules differ even when the pieces look alike?
3. Where did the matched position come from, and can the user inspect it without losing the drill?

The phone-first default uses the existing full-width drill board. Expanding a
comparison highlights changed squares there and shows a compact difference list
below it. A later explicit Current/Matched toggle may reuse that same board;
two permanently visible miniature boards are deferred because they make pieces
hard to read on phones and previously caused fragile board sizing.

## Comparison contract

- Compare normalized position identity: piece placement, side to move, castling
  rights, and legal en-passant square. Halfmove/fullmove counters are context,
  not position differences.
- For each changed square, store the current occupant and matched occupant using
  stable color/piece names; never infer that two changed squares are one move.
- Keep similarity ranking based on piece-placement distance initially, but show
  rule-state differences before claiming a likely transposition.
- Attach module/line provenance when available. An exact FEN reached through a
  different move order is a transposition; a nonzero board diff is only similar.
- Explorer navigation must carry complete move-order context where available and
  preserve the active drill session when the user returns.

## Delivery slices

### C0 — Deterministic evidence and drill disclosure

- [x] Produce structured changed-square and rule-state evidence.
- [x] Add a Compare positions disclosure to wrong-move feedback.
- [x] Highlight changed squares on the main drill board while expanded.
- [x] Add positive/negative unit tests for piece and rule-state differences.

### C1 — Matched-position viewing and provenance

- [ ] Add an explicit Current/Matched board toggle with clear orientation/state labels.
- [ ] Resolve contributing profile, module, authored line, and prepared move labels.
- [ ] Distinguish exact transposition, same placement/different rights, and merely similar positions.
- [ ] Add View matched position in Explorer while preserving drill state.
- [ ] Cover the interaction at phone and desktop sizes.

### C2 — Feature-level explanation

- [ ] Compare cached A2 facts in addition to raw pieces/rules.
- [ ] Prioritize differences that explain why the attempted move works in one position.
- [ ] Show engine consequences only when cached/computed evidence supports them.
- [ ] Suppress redundant or irrelevant changes and calibrate explanation wording.

## Verification

- Unit-test identical boards, one moved/missing/replaced piece, side-to-move,
  castling, legal en-passant, malformed FEN, and deterministic ordering.
- Browser-test opening/closing the comparison, changed-square highlights, session
  continuity, Current/Matched switching, and Explorer round trips.
- Test narrow portrait layouts first, then verify desktop remains balanced.
