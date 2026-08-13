import { useEffect, useMemo, useState } from 'react'
import { generateOpeningCandidate, type OpeningGenerationResult } from '../lib/openingGeneratorApi'
import type { RepertoireColor } from '../types'

type Props = {
  color: RepertoireColor
  prefixUci: string[]
  openingName?: string | null
  lichessToken?: string
  onAddLines: (name: string, pgn: string) => Promise<number>
}

function download(filename: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function OpeningGeneratorPanel({ color, prefixUci, openingName, lichessToken, onAddLines }: Props) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(openingName ?? '')
  const [maxLines, setMaxLines] = useState(15)
  const [maxPly, setMaxPly] = useState(Math.max(22, prefixUci.length + 4))
  const [coverage, setCoverage] = useState(85)
  const [useEngine, setUseEngine] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addedCount, setAddedCount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<OpeningGenerationResult | null>(null)
  const slug = useMemo(() => (name || 'opening').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), [name])

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
      setAddedCount(await onAddLines(result.name, result.pgn))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not add the generated lines.')
    } finally {
      setAdding(false)
    }
  }

  return <section className="panel opening-generator-panel">
    <div className="opening-generator-heading"><div><h2>Recommended tree <span className="development-tag">In development</span></h2><p>Build a practical repertoire from the selected explorer position.</p></div><button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>{open ? 'Close' : 'Open generator'}</button></div>
    {open && <div className="opening-generator-form">
      {prefixUci.length === 0 && <p className="panel-status error">Play or load an opening line before generating.</p>}
      <label>Module name<input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="e.g. Fried Liver Attack" /></label>
      <div className="opening-generator-grid">
        <label>Leaf limit<input type="number" min={1} max={250} value={maxLines} onChange={(event) => setMaxLines(Number(event.target.value))} /></label>
        <label>Maximum ply<input type="number" min={prefixUci.length + 1} max={80} value={maxPly} onChange={(event) => setMaxPly(Number(event.target.value))} /></label>
        <label>Opponent coverage<input type="number" min={1} max={100} value={coverage} onChange={(event) => setCoverage(Number(event.target.value))} /><small>Percent at each opponent position</small></label>
      </div>
      <label className="opening-generator-check"><input type="checkbox" checked={useEngine} onChange={(event) => setUseEngine(event.target.checked)} /> Filter repertoire choices with server Stockfish</label>
      <p className="panel-status">Starting after {prefixUci.length} plies · generating for {color}. Generation may take a minute.</p>
      {error && <p className="panel-status error" role="alert">{error}</p>}
      <button type="button" disabled={generating || prefixUci.length === 0 || name.trim() === '' || maxPly <= prefixUci.length} onClick={() => void submit()}>{generating ? 'Generating…' : 'Generate recommended tree'}</button>
      {result && <div className="opening-generator-result"><strong>{result.leafCount} leaf lines generated</strong><p>Creates a new personal {color} module.</p><div className="board-controls"><button type="button" disabled={adding || addedCount !== null} onClick={() => void addToModule()}>{addedCount !== null ? `Added ${addedCount} lines` : adding ? 'Adding…' : 'Create my module'}</button><button type="button" onClick={() => download(`${slug}.pgn`, result.pgn, 'application/x-chess-pgn')}>Download PGN</button><button type="button" onClick={() => download(`${slug}.report.json`, `${JSON.stringify(result.report, null, 2)}\n`, 'application/json')}>Download report</button></div><details><summary>Preview PGN</summary><pre>{result.pgn}</pre></details></div>}
    </div>}
  </section>
}
