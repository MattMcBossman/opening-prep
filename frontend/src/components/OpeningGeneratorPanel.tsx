import { useEffect, useMemo, useState } from 'react'
import { generateOpeningCandidate, type OpeningGenerationResult } from '../lib/openingGeneratorApi'
import type { RepertoireColor } from '../types'

type Props = {
  color: RepertoireColor
  prefixUci: string[]
  openingName?: string | null
  lichessToken?: string
  existingLines: string[][]
  canFillGaps: boolean
  onAddLines: (name: string, pgn: string) => Promise<number>
  onFillLines: (pgn: string) => Promise<number>
}

function download(filename: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function OpeningGeneratorPanel({ color, prefixUci, openingName, lichessToken, existingLines, canFillGaps, onAddLines, onFillLines }: Props) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(openingName ?? '')
  const [maxLines, setMaxLines] = useState(50)
  const [maxPly, setMaxPly] = useState(Math.max(22, prefixUci.length + 4))
  const [coverage, setCoverage] = useState(60)
  const [useEngine, setUseEngine] = useState(false)
  const [mode, setMode] = useState<'new_tree' | 'fill_gaps'>('new_tree')
  const [generating, setGenerating] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addedCount, setAddedCount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<OpeningGenerationResult | null>(null)
  const slug = useMemo(() => (name || 'opening').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), [name])
  const summary = result?.report.summary
  const limitedPositionCount = summary
    ? summary.leafBudgetLimited + summary.replyLimitReached + summary.frequencyThresholdLimited
    : 0

  useEffect(() => {
    if (!open) return
    setName(openingName ?? '')
    setMaxPly((value) => Math.max(value, prefixUci.length + 4))
    setResult(null)
    setAddedCount(null)
    setError(null)
  }, [open, openingName, prefixUci])

  const submit = async () => {
    setGenerating(true)
    setError(null)
    setResult(null)
    setAddedCount(null)
    try {
      setResult(await generateOpeningCandidate({
        name: name.trim(), color, prefix: prefixUci, coverage: coverage / 100,
        maxLines, maxPly, minGames: 20, minFrequency: 0.01,
        maxOpponentReplies: 8, useEngine, engineDepth: 16,
        maxEngineLossCp: 35, engineCandidates: 5,
        mode, existingLines: mode === 'fill_gaps' ? existingLines : [], moveBudget: maxLines,
        ...(lichessToken ? { lichessToken } : {}),
      }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Generation failed.')
    } finally {
      setGenerating(false)
    }
  }

  const addToModule = async () => {
    if (!result) return
    setAdding(true)
    setError(null)
    try {
      setAddedCount(await (mode === 'fill_gaps' ? onFillLines(result.pgn) : onAddLines(result.name, result.pgn)))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not add the generated lines.')
    } finally {
      setAdding(false)
    }
  }

  return <section className="panel opening-generator-panel" data-guide="opening-generator">
    <div className="opening-generator-heading"><div><h2>Recommended tree <span className="development-tag">In development</span></h2><p>Build a practical repertoire from the selected explorer position.</p></div><button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>{open ? 'Close' : 'Open generator'}</button></div>
    {open && <div className="opening-generator-form">
      {prefixUci.length === 0 && <p className="panel-status error">Play or load an opening line before generating.</p>}
      <label>Module name<input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="e.g. Fried Liver Attack" /></label>
      <div className="board-controls opening-generator-mode">
        <button type="button" className={mode === 'new_tree' ? 'active' : ''} onClick={() => setMode('new_tree')}>New module</button>
        <button type="button" className={mode === 'fill_gaps' ? 'active' : ''} disabled={!canFillGaps} onClick={() => setMode('fill_gaps')}>Fill selected module</button>
      </div>
      {!canFillGaps && <small>Edit a personal module to review and add gap recommendations.</small>}
      <div className="opening-generator-grid">
        <label>Leaf limit<input type="number" min={1} max={250} value={maxLines} onChange={(event) => setMaxLines(Number(event.target.value))} /></label>
        <label>Maximum ply<input type="number" min={prefixUci.length + 1} max={80} value={maxPly} onChange={(event) => setMaxPly(Number(event.target.value))} /></label>
        <label>Opponent coverage<input type="number" min={1} max={100} value={coverage} onChange={(event) => setCoverage(Number(event.target.value))} /><small>Percent at each opponent position</small></label>
      </div>
      <label className="opening-generator-check"><input type="checkbox" checked={useEngine} onChange={(event) => setUseEngine(event.target.checked)} /> Filter repertoire choices with server Stockfish</label>
      <p className="panel-status">Starting after {prefixUci.length} plies · generating for {color}. Generation may take a minute.</p>
      {error && <p className="panel-status error" role="alert">{error}</p>}
      <button type="button" disabled={generating || prefixUci.length === 0 || name.trim() === '' || maxPly <= prefixUci.length} onClick={() => void submit()}>{generating ? 'Generating…' : 'Generate recommended tree'}</button>
      {result && <div className="opening-generator-result">
        <strong>{result.leafCount} {mode === 'fill_gaps' ? 'gap recommendations' : 'leaf lines generated'}</strong>
        <p>{mode === 'fill_gaps' ? 'Review these recommendations before adding them to the selected module.' : `Review the quality checks before creating a new personal ${color} module.`}</p>
        {mode === 'fill_gaps' && result.proposals && <div className="opening-generator-summary" aria-label="Gap recommendation summary">
          <span><strong>{result.proposals.reduce((total, proposal) => total + proposal.newMoveCount, 0)}</strong> new moves</span>
          <span><strong>{result.proposals.filter((proposal) => proposal.exactTransposition).length}</strong> exact transpositions</span>
          <span><strong>{result.proposals.filter((proposal) => proposal.similarityDistance !== null && proposal.similarityDistance <= 6).length}</strong> familiar positions</span>
        </div>}
        {summary && <div className="opening-generator-summary" aria-label="Generated tree quality summary">
          <span><strong>{summary.coverageTargetMet} of {summary.opponentPositions}</strong> opponent positions met the coverage target</span>
          <span><strong>{summary.minimumOpponentCoverage === null ? 'No data' : `${(summary.minimumOpponentCoverage * 100).toFixed(1)}%`}</strong> minimum sampled coverage</span>
          <span><strong>{summary.maximumGeneratedPly}</strong> deepest generated ply</span>
          <span><strong>{result.report.engine ? 'Stockfish filtered' : 'Popularity only'}</strong> repertoire move selection</span>
        </div>}
        {summary && limitedPositionCount > 0 && <p className="panel-status opening-generator-warning">
          {limitedPositionCount} opponent position{limitedPositionCount === 1 ? ' was' : 's were'} below target because of the leaf budget, reply limit, or frequency threshold. Inspect the report before importing.
        </p>}
        {summary && summary.noEligibleMoves > 0 && <p className="panel-status opening-generator-warning">
          {summary.noEligibleMoves} opponent position{summary.noEligibleMoves === 1 ? ' had' : 's had'} no reply above the configured sample thresholds.
        </p>}
        {!result.report.engine && <p className="panel-status opening-generator-warning">Without engine filtering, Mainline chooses your moves by Lichess popularity rather than objective soundness.</p>}
        <div className="board-controls"><button type="button" disabled={adding || addedCount !== null || result.leafCount === 0} onClick={() => void addToModule()}>{addedCount !== null ? `Added ${addedCount} lines` : adding ? 'Adding…' : mode === 'fill_gaps' ? 'Add recommendations to draft' : 'Create my module'}</button><button type="button" onClick={() => download(`${slug}.pgn`, result.pgn, 'application/x-chess-pgn')}>Download PGN</button><button type="button" onClick={() => download(`${slug}.report.json`, `${JSON.stringify(result.report, null, 2)}\n`, 'application/json')}>Download report</button></div>
        <details><summary>Preview PGN</summary><pre>{result.pgn}</pre></details>
      </div>}
    </div>}
  </section>
}
