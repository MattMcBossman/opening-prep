import type { LichessDatabaseFilters } from '../lib/lichessExplorer'
import type { ExplorerSource } from '../hooks/useExplorerStats'

const RATING_BANDS = ['1600', '1800', '2000', '2200', '2500']
const SPEEDS: Array<{ value: string; label: string }> = [
  { value: 'ultraBullet', label: 'UltraBullet' },
  { value: 'bullet', label: 'Bullet' },
  { value: 'blitz', label: 'Blitz' },
  { value: 'rapid', label: 'Rapid' },
  { value: 'classical', label: 'Classical' },
  { value: 'correspondence', label: 'Correspondence' },
]

type Props = {
  /** Rating/speed checkboxes only apply to (and only render for) the 'lichess' source - see LichessDatabaseFilters. */
  source: ExplorerSource
  filters: LichessDatabaseFilters
  onChange: (filters: LichessDatabaseFilters) => void
}

function toggled(list: string[] | undefined, value: string): string[] {
  const current = list ?? []
  return current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
}

/** Explorer query filters: since/until apply to whichever source is active; rating bands and game type are Lichess-database-only. */
export function ExplorerFiltersPanel({ source, filters, onChange }: Props) {
  return (
    <div className="explorer-filters">
      <div className="explorer-filters-row">
        <label className="explorer-filters-month">
          From
          <input
            type="month"
            value={filters.since ?? ''}
            onChange={(e) => onChange({ ...filters, since: e.target.value || undefined })}
          />
        </label>
        <label className="explorer-filters-month">
          To
          <input
            type="month"
            value={filters.until ?? ''}
            onChange={(e) => onChange({ ...filters, until: e.target.value || undefined })}
          />
        </label>
      </div>
      {source === 'lichess' && (
        <>
          <fieldset className="explorer-filters-group">
            <legend>Rating</legend>
            {RATING_BANDS.map((band) => (
              <label key={band} className="explorer-filters-checkbox">
                <input
                  type="checkbox"
                  checked={filters.ratings?.includes(band) ?? false}
                  onChange={() => onChange({ ...filters, ratings: toggled(filters.ratings, band) })}
                />
                {band}+
              </label>
            ))}
          </fieldset>
          <fieldset className="explorer-filters-group">
            <legend>Game type</legend>
            {SPEEDS.map(({ value, label }) => (
              <label key={value} className="explorer-filters-checkbox">
                <input
                  type="checkbox"
                  checked={filters.speeds?.includes(value) ?? false}
                  onChange={() => onChange({ ...filters, speeds: toggled(filters.speeds, value) })}
                />
                {label}
              </label>
            ))}
          </fieldset>
        </>
      )}
    </div>
  )
}
