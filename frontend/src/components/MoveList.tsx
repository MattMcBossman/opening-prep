import { useEffect, useMemo, useRef, useState } from 'react'
import type { HistoryEntry } from '../hooks/useGame'
import { buildContinuationTree } from '../lib/continuationTree'
import type { ContinuationTreeNode } from '../lib/continuationTree'
import type { RepertoireColor, RepertoireMove } from '../types'

type PlayedCell = { entry: HistoryEntry; index: number }
type PlayedRow = { moveNumber: number; white?: PlayedCell; black?: PlayedCell }

type Props = {
  moves: HistoryEntry[]
  pointer: number
  currentFen: string
  onSelect: (index: number) => void
  boardColor: RepertoireColor
  isPlySaved: (index: number) => boolean
  getPlySaveState?: (index: number) => 'unsaved' | 'saved' | 'pending-add' | 'pending-remove'
  onTogglePlySaved: (index: number, point: { x: number; y: number }) => void
  canEditModule?: boolean
  expandAllContinuations?: boolean
  getContinuations: (fen: string) => RepertoireMove[]
  onPlayContinuationPath: (moves: RepertoireMove[]) => void
  continuationMovesInteractive?: boolean
  continuationHeading?: string
  autoScroll?: boolean
  responsiveContinuationExpansion?: boolean
  showSaveControls?: boolean
  continuationChainPlies?: number
  responsiveContinuationChain?: boolean
}

function StarButton({ saved, state, onToggle, canEdit }: { saved: boolean; state: 'unsaved' | 'saved' | 'pending-add' | 'pending-remove'; onToggle: (point: { x: number; y: number }) => void; canEdit: boolean }) {
  const title = canEdit
    ? state === 'pending-add' ? 'Will be added when saved'
      : state === 'pending-remove' ? 'Will be removed when saved'
        : saved ? 'Remove from module' : 'Save to module'
    : 'Select Edit to change this module'
  return (
    <button
      type="button"
      className={`move-star ${state}`}
      title={title}
      aria-label={title}
      aria-disabled={!canEdit}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        onToggle({
          x: event.clientX || rect.right,
          y: event.clientY || rect.top + rect.height / 2,
        })
      }}
    >
      {saved ? '\u2605' : '\u2606'}
    </button>
  )
}

function buildPlayedRows(moves: HistoryEntry[], pointer: number): PlayedRow[] {
  const rows: PlayedRow[] = []
  moves.slice(0, pointer).forEach((entry, index) => {
    const cell = { entry, index }
    if (index % 2 === 0) rows.push({ moveNumber: Math.floor(index / 2) + 1, white: cell })
    else rows[rows.length - 1].black = cell
  })
  return rows
}

function movePrefix(ply: number): string {
  const number = Math.floor(ply / 2) + 1
  return ply % 2 === 0 ? `${number}.` : `${number}...`
}

export function MoveList({
  moves,
  pointer,
  currentFen,
  onSelect,
  boardColor,
  isPlySaved,
  getPlySaveState = (index) => isPlySaved(index) ? 'saved' : 'unsaved',
  onTogglePlySaved,
  canEditModule = true,
  expandAllContinuations = false,
  getContinuations,
  onPlayContinuationPath,
  continuationMovesInteractive = true,
  continuationHeading = 'Saved continuations',
  autoScroll = true,
  responsiveContinuationExpansion = false,
  showSaveControls = true,
  continuationChainPlies = 2,
  responsiveContinuationChain = false,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const [expansionOverrides, setExpansionOverrides] = useState<Record<string, boolean>>({})
  const [continuationWidth, setContinuationWidth] = useState(0)
  const playedRows = buildPlayedRows(moves, pointer)
  const effectiveChainPlies = responsiveContinuationChain
    ? continuationWidth >= 620 ? 8 : continuationWidth >= 420 ? 6 : 4
    : continuationChainPlies
  const tree = useMemo(
    () => buildContinuationTree(currentFen, pointer, getContinuations, () => true, effectiveChainPlies),
    [currentFen, effectiveChainPlies, pointer, getContinuations],
  )
  const treeKey = tree.map((node) => node.key).join('|')

  useEffect(() => {
    if ((!responsiveContinuationExpansion && !responsiveContinuationChain) || !listRef.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setContinuationWidth(entry.contentRect.width))
    observer.observe(listRef.current)
    return () => observer.disconnect()
  }, [responsiveContinuationChain, responsiveContinuationExpansion])

  useEffect(() => {
    if (!autoScroll) return
    const frame = requestAnimationFrame(() => {
      const list = listRef.current
      if (!list) return
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      list.scrollTo({ top: list.scrollHeight, behavior: reducedMotion ? 'auto' : 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [autoScroll, pointer, treeKey])

  function renderPlayedRow(row: PlayedRow, index: number) {
    const renderCell = (cell?: PlayedCell) => !cell ? <span /> : (
      <button type="button" className={pointer === cell.index + 1 ? 'move-button active' : 'move-button'} onClick={() => onSelect(cell.index + 1)}>
        {cell.entry.san}
      </button>
    )
    const star = (cell?: PlayedCell) => showSaveControls && cell
      ? <StarButton saved={isPlySaved(cell.index)} state={getPlySaveState(cell.index)} canEdit={canEditModule} onToggle={(point) => onTogglePlySaved(cell.index, point)} />
      : null
    return (
      <div className="move-row" key={`played-${index}`}>
        <span className="move-star-slot">{boardColor === 'white' ? star(row.white) : null}</span>
        <span className="move-number">{row.moveNumber}.</span>
        {renderCell(row.white)}
        {renderCell(row.black)}
        <span className="move-star-slot">{boardColor === 'black' ? star(row.black) : null}</span>
      </div>
    )
  }

  function renderTreeNode(node: ContinuationTreeNode, depth: number, parentPath: RepertoireMove[]): React.ReactNode {
    const path = [...parentPath, ...node.chain.map((item) => item.move)]
    const expandable = node.childCount > 0
    const responsiveDepth = continuationWidth >= 620 ? 2 : continuationWidth >= 420 ? 1 : 0
    const defaultExpanded = responsiveContinuationExpansion ? depth <= responsiveDepth : depth === 0
    const expanded = expandAllContinuations || (expansionOverrides[node.key] ?? defaultExpanded)
    return (
      <div className="continuation-branch" key={node.key}>
        <div className="continuation-tree-row" style={{ '--tree-depth': depth } as React.CSSProperties}>
          <button
            type="button"
            className="continuation-disclosure"
            aria-label={expandable ? `${expanded ? 'Collapse' : 'Expand'} ${node.chain[0].move.san}` : undefined}
            aria-expanded={expandable ? expanded : undefined}
            disabled={!expandable}
            onClick={() => setExpansionOverrides((current) => ({ ...current, [node.key]: !expanded }))}
          >
            {expandable ? <span className="continuation-chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span> : null}
          </button>
          <span className="continuation-connector" aria-hidden="true">{depth > 0 ? '└' : ''}</span>
          <div className="continuation-chain">
            {node.chain.map((item, itemIndex) => (
              <span className="continuation-move-group" key={`${node.key}-${item.move.uci}`}>
                {/* A Black move paired directly after White already inherits
                    that row's move number: "4. a5 a6", not "4. a5 4... a6".
                    Keep the ellipsis when the chain itself begins with Black. */}
                {!(item.ply % 2 === 1 && node.chain[itemIndex - 1]?.ply === item.ply - 1)
                  && <span className="continuation-move-number">{movePrefix(item.ply)}</span>}
                {continuationMovesInteractive
                  ? <button
                      type="button"
                      className="continuation-move-button"
                      onClick={() => onPlayContinuationPath([...parentPath, ...node.chain.slice(0, itemIndex + 1).map((part) => part.move)])}
                      title={item.move.san}
                    >
                      {item.move.san}
                    </button>
                  : <span className="continuation-move-button continuation-move-preview" title={item.move.san}>{item.move.san}</span>}
              </span>
            ))}
          </div>
          {expandable && !expanded && !node.truncated && (
            <span className="continuation-line-count">
              {node.leafCount} {node.leafCount === 1 ? 'line' : 'lines'}
            </span>
          )}
        </div>
        {(node.transposesTo || node.cycle) && (
          <p className="continuation-transposition" style={{ '--tree-depth': depth + 1 } as React.CSSProperties}>
            ↪ {node.cycle ? 'Returns to an earlier position' : `Transposes to ${node.transposesTo}`}
          </p>
        )}
        {expandable && expanded && (
          <div className="continuation-children">
            {node.children.map((child) => renderTreeNode(child, depth + 1, path))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div ref={listRef} className={`move-list${!responsiveContinuationChain && continuationChainPlies === 2 ? ' paired-continuations' : ''}`}>
      {playedRows.map(renderPlayedRow)}
      {playedRows.length > 0 && tree.length > 0 && <div className="move-list-divider" />}
      {tree.length > 0 && <p className="continuation-tree-heading">{continuationHeading}</p>}
      {tree.map((node) => renderTreeNode(node, 0, []))}
      {playedRows.length === 0 && tree.length === 0 && <p className="panel-status">Play a move to begin.</p>}
      {playedRows.length > 0 && tree.length === 0 && <p className="panel-status">No saved continuations from this position.</p>}
    </div>
  )
}
