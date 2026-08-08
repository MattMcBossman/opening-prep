import { useEffect, useState } from 'react'

type Props = {
  token: string
  onChange: (token: string) => void
}

const CREATE_TOKEN_URL =
  'https://lichess.org/account/oauth/token/create?scopes=&description=opening-prep'

export function LichessTokenSettings({ token, onChange }: Props) {
  const [draft, setDraft] = useState(token)

  useEffect(() => setDraft(token), [token])

  return (
    <div className="token-settings">
      <label htmlFor="lichess-token">Lichess API token</label>
      <div className="token-settings-row">
        <input
          id="lichess-token"
          type="password"
          placeholder="lip_xxxxxxxxxxxx"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="button" onClick={() => onChange(draft.trim())}>
          Save
        </button>
      </div>
      <p className="token-settings-hint">
        Lichess now requires a personal API token on every Opening Explorer request.{' '}
        <a href={CREATE_TOKEN_URL} target="_blank" rel="noreferrer">
          Create a free token
        </a>{' '}
        (no scopes needed) and paste it here — it's stored only in this browser.
      </p>
    </div>
  )
}
