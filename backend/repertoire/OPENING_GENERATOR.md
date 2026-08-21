# Opening candidate generator

Global modules are generated as reviewable candidates rather than published
directly from opening statistics. The generator branches across common
opponent replies, chooses one practical repertoire-side move, and stops at a
global leaf/depth budget. Gaps are expected: coverage and omitted moves are
reported for curator review, not treated as publication failures.

Set a Lichess personal API token in the process environment, then run:

```bash
export LICHESS_SERVER_TOKEN=...
uv run manage.py generate_opening_candidate \
  --name "Fried Liver Attack" \
  --color white \
  --prefix e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 \
  --coverage 0.85 \
  --max-lines 15 \
  --max-ply 22 \
  --output candidates/fried-liver.pgn
```

The prefix may mix SAN and UCI moves but must start from the standard initial
position. The command creates the requested PGN and an adjacent
`.report.json`. The report records every visited position, included and
omitted moves with game counts/frequencies, the local covered fraction, and
all generation settings.

Without Stockfish, repertoire-side nodes choose the most-played eligible move.
Pass `--stockfish /path/to/stockfish` to analyze the elite-game candidates.
Within `--max-engine-loss-cp` of the best evaluation, selection balances engine
quality, surprise in the full game population, and how many likely opponent
replies are needed to reach the requested coverage. Stockfish also supplies
best play when a position has no usable Lichess sample. `--engine-depth`
controls analysis depth. The production image configures this automatically.

Useful scope controls:

- `--max-lines` is a hard cap on leaf lines. A focused module can reasonably
  use 10–15; broad opening families can use substantially more.
- `--coverage` is the desired local share of opponent play, bounded by the
  leaf budget, frequency threshold, and reply cap.
- `--min-games` and `--min-frequency` remove statistically weak tails.
- `--ratings` and `--speeds` accept the comma-separated values supported by
  the Lichess opening explorer.

Generation never creates or updates an `OpeningTemplateRelease`. Review and
edit the PGN first, import it as a personal module, and publish a new immutable
release through the curator workflow. Publication continues to validate only
legal, connected release structure; coverage and engine scores are advisory.
