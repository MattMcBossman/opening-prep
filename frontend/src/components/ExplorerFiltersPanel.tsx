import { useEffect, useState } from 'react'
import type { LichessDatabaseFilters } from '../lib/lichessExplorer'
import type { ExplorerSource } from '../hooks/useExplorerStats'

const RATING_BANDS = ['1600', '1800', '2000', '2200', '2500']
const SPEEDS: Array<{ values: string[]; label: string }> = [
  { values: ['bullet', 'ultraBullet'], label: 'Bullet' },
  { values: ['blitz'], label: 'Blitz' },
  { values: ['rapid'], label: 'Rapid' },
  { values: ['classical'], label: 'Classical' },
  { values: ['correspondence'], label: 'Correspondence' },
]
const MONTHS = [
  ['01', 'Jan'], ['02', 'Feb'], ['03', 'Mar'], ['04', 'Apr'], ['05', 'May'], ['06', 'Jun'],
  ['07', 'Jul'], ['08', 'Aug'], ['09', 'Sep'], ['10', 'Oct'], ['11', 'Nov'], ['12', 'Dec'],
] as const
const YEARS = Array.from({ length: new Date().getFullYear() - 2009 }, (_, index) => String(new Date().getFullYear() - index))

type Props = {
  /** Ratings apply only to the public database; game speeds apply to both sources. */
  source: ExplorerSource
  filters: LichessDatabaseFilters
  onChange: (filters: LichessDatabaseFilters) => void
}

function toggled(list: string[] | undefined, value: string): string[] {
  const current = list ?? []
  return current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
}

function toggledGroup(list: string[] | undefined, values: string[]): string[] {
  const current = list ?? []
  const selected = values.some((value) => current.includes(value))
  return selected
    ? current.filter((value) => !values.includes(value))
    : [...current.filter((value) => !values.includes(value)), ...values]
}

function MonthYearSelect({
  label,
  value,
  onChange,
}: {
  label: 'From' | 'To'
  value?: string
  onChange: (value: string | undefined) => void
}) {
  const valid = /^\d{4}-\d{2}$/.test(value ?? '') ? value! : ''
  const [year, setYear] = useState(valid.slice(0, 4))
  const [month, setMonth] = useState(valid.slice(5, 7))

  useEffect(() => {
    const next = /^\d{4}-\d{2}$/.test(value ?? '') ? value! : ''
    setYear(next.slice(0, 4))
    setMonth(next.slice(5, 7))
  }, [value])

  const update = (nextYear: string, nextMonth: string) => {
    setYear(nextYear)
    setMonth(nextMonth)
    // Never leak an incomplete/invalid boundary into an API request.
    onChange(nextYear && nextMonth ? `${nextYear}-${nextMonth}` : undefined)
  }

  return (
    <fieldset className="explorer-filters-month">
      <legend>{label}</legend>
      <div>
        <select aria-label={`${label} month`} value={month} onChange={(event) => update(year, event.target.value)}>
          <option value="">Month</option>
          {MONTHS.map(([number, name]) => <option key={number} value={number}>{name}</option>)}
        </select>
        <select aria-label={`${label} year`} value={year} onChange={(event) => update(event.target.value, month)}>
          <option value="">Year</option>
          {YEARS.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}
        </select>
      </div>
    </fieldset>
  )
}

/** Explorer query filters: since/until and game type apply to both sources; rating bands are public-database-only. */
export function ExplorerFiltersPanel({ source, filters, onChange }: Props) {
  // Control disclosure state so Chromium's form-state restoration cannot
  // occasionally reopen it on a fresh app mount and shift the mobile toolbar.
  const [open, setOpen] = useState(false)
  const activeCount =
    Number(Boolean(filters.since)) +
    Number(Boolean(filters.until)) +
    (source === 'lichess' ? (filters.ratings?.length ?? 0) : 0) +
    SPEEDS.filter(({ values }) => values.some((value) => filters.speeds?.includes(value) ?? false)).length

  return (
    <details
      className="explorer-filters-disclosure"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span>Filters</span>
        {activeCount > 0 && <span className="explorer-filter-count">{activeCount} active</span>}
      </summary>
      <div className="explorer-filters">
        <div className="explorer-filters-row">
          <MonthYearSelect label="From" value={filters.since} onChange={(since) => onChange({ ...filters, since })} />
          <MonthYearSelect label="To" value={filters.until} onChange={(until) => onChange({ ...filters, until })} />
        </div>
        {source === 'lichess' && (
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
        )}
        <fieldset className="explorer-filters-group">
          <legend>Game type</legend>
          {SPEEDS.map(({ values, label }) => (
            <label key={label} className="explorer-filters-checkbox">
              <input
                type="checkbox"
                checked={values.some((value) => filters.speeds?.includes(value) ?? false)}
                onChange={() => onChange({ ...filters, speeds: toggledGroup(filters.speeds, values) })}
              />
              {label}
            </label>
          ))}
        </fieldset>
      </div>
    </details>
  )
}
