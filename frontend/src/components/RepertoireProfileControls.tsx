import { useEffect, useState } from 'react'
import {
  fetchOpeningTemplateRelease,
  listOpeningTemplates,
  type OpeningTemplateRelease,
  type OpeningTemplateSummary,
  type RepertoireProfileSummary,
  type RepertoireSummary,
} from '../lib/repertoireApi'
import type { RepertoireColor } from '../types'
import { findMissingReleaseLines } from '../lib/repertoireOverlay'

type AsyncAction = () => Promise<unknown>

type Props = {
  profiles: RepertoireProfileSummary[]
  modules: RepertoireSummary[]
  activeProfileId: number | null
  editingModuleId: number | null
  editingLinePaths: string[]
  color: RepertoireColor
  disabled?: boolean
  showGlobalLibrary?: boolean
  onProfileChange: (profileId: number) => void
  onEditingModuleChange: (moduleId: number) => void
  onCreateProfile: (name: string) => Promise<unknown>
  onRenameProfile: (id: number, name: string) => Promise<unknown>
  onDeleteProfile: (id: number) => Promise<unknown>
  onCreateModule: (color: RepertoireColor, name: string, description?: string, profileId?: number) => Promise<unknown>
  onRenameModule: (id: number, name: string) => Promise<unknown>
  onDeleteModule: (id: number) => Promise<unknown>
  onSetMembership: (profileId: number, moduleId: number, sortOrder: number, enabled: boolean) => Promise<unknown>
  onRemoveMembership: (profileId: number, moduleId: number) => Promise<unknown>
  onPinTemplate: (profileId: number, releaseId: number, sortOrder?: number) => Promise<unknown>
  onUnpinTemplate: (profileId: number, releaseId: number) => Promise<unknown>
  onCopyTemplate: (slug: string, version: number, profileId?: number) => Promise<unknown>
  onCopyMissingTemplateLines: (slug: string, version: number, moduleId: number) => Promise<unknown>
  onPreviewTemplate: (release: OpeningTemplateRelease | null) => void
}

export function RepertoireProfileControls(props: Props) {
  const {
    profiles, activeProfileId, editingModuleId, color, disabled = false,
    onProfileChange, onEditingModuleChange,
  } = props
  const [managing, setManaging] = useState(false)
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? null
  const editableModules = activeProfile?.modules.filter((module) => module.enabled && module.color === color) ?? []

  if (profiles.length === 0) return null

  return (
    <div className="repertoire-profile-controls" aria-label="Repertoire profile and editing module">
      <label><span>Profile</span><select value={activeProfileId ?? ''} disabled={disabled} onChange={(event) => onProfileChange(Number(event.target.value))}>
        {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
      </select></label>
      <label><span>Editing</span><select value={editingModuleId ?? ''} disabled={disabled || editableModules.length === 0} onChange={(event) => onEditingModuleChange(Number(event.target.value))}>
        {editableModules.length === 0 ? <option value="">No {color} module</option> : editableModules.map((module) => <option key={module.id} value={module.id}>{module.name}</option>)}
      </select></label>
      <button type="button" className="profile-manage-button" aria-expanded={managing} onClick={() => { if (managing) props.onPreviewTemplate(null); setManaging((value) => !value) }}>Manage</button>
      {managing && <ProfileManager {...props} activeProfile={activeProfile} onClose={() => { props.onPreviewTemplate(null); setManaging(false) }} />}
    </div>
  )
}

function ProfileManager({ activeProfile, onClose, ...props }: Props & { activeProfile: RepertoireProfileSummary | null; onClose: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const run = async (action: AsyncAction) => {
    setBusy(true); setLocalError(null)
    try { await action() } catch (error) { setLocalError(error instanceof Error ? error.message : 'The change could not be saved.') } finally { setBusy(false) }
  }
  return <div className="profile-manager" role="dialog" aria-label="Manage repertoire profiles">
    <div className="profile-manager-heading"><strong>Profiles &amp; opening modules</strong><button type="button" onClick={onClose} aria-label="Close">×</button></div>
    {localError && <p className="panel-status error">{localError}</p>}
    <form onSubmit={(event) => { event.preventDefault(); const value = name.trim(); if (value) void run(async () => { await props.onCreateProfile(value); setName('') }) }}>
      <input aria-label="New profile name" placeholder="New profile (e.g. Tournament)" value={name} onChange={(event) => setName(event.target.value)} />
      <button disabled={busy || !name.trim()}>Create profile</button>
    </form>
    {activeProfile && <section>
      <div className="manager-row"><strong>{activeProfile.name}</strong>
        <button disabled={busy} onClick={() => { const value = window.prompt('Profile name', activeProfile.name)?.trim(); if (value) void run(() => props.onRenameProfile(activeProfile.id, value)) }}>Rename</button>
        {props.profiles.length > 1 && <button className="danger" disabled={busy} onClick={() => { if (window.confirm(`Delete profile “${activeProfile.name}”? Its modules will be kept.`)) void run(() => props.onDeleteProfile(activeProfile.id)) }}>Delete</button>}
      </div>
      <h4>Personal opening modules</h4>
      {props.modules.map((module) => {
        const membership = activeProfile.modules.find((candidate) => candidate.id === module.id)
        const membershipIndex = membership ? activeProfile.modules.findIndex((candidate) => candidate.id === module.id) : -1
        const moveMembership = async (offset: -1 | 1) => {
          if (!membership) return
          const other = activeProfile.modules[membershipIndex + offset]
          if (!other) return
          await props.onSetMembership(activeProfile.id, other.id, membership.sortOrder, other.enabled)
          await props.onSetMembership(activeProfile.id, module.id, other.sortOrder, membership.enabled)
        }
        return <div className="manager-row" key={module.id}>
          <span>{module.name} <small>{module.color}</small></span>
          {membership ? <>
            <label><input type="checkbox" checked={membership.enabled} onChange={(event) => void run(() => props.onSetMembership(activeProfile.id, module.id, membership.sortOrder, event.target.checked))} /> enabled</label>
            <button disabled={busy || membershipIndex === 0} onClick={() => void run(() => moveMembership(-1))}>↑</button>
            <button disabled={busy || membershipIndex === activeProfile.modules.length - 1} onClick={() => void run(() => moveMembership(1))}>↓</button>
            <button disabled={busy} onClick={() => void run(() => props.onRemoveMembership(activeProfile.id, module.id))}>Detach</button>
          </> : <button disabled={busy} onClick={() => void run(() => props.onSetMembership(activeProfile.id, module.id, activeProfile.modules.length, true))}>Attach</button>}
          <button disabled={busy} onClick={() => { const value = window.prompt('Module name', module.name)?.trim(); if (value) void run(() => props.onRenameModule(module.id, value)) }}>Rename</button>
          <button className="danger" disabled={busy} onClick={() => { if (window.confirm(`Delete module “${module.name}” and all of its lines?`)) void run(() => props.onDeleteModule(module.id)) }}>Delete</button>
        </div>
      })}
      <button disabled={busy} onClick={() => { const value = window.prompt(`Name for the new ${props.color} opening module`)?.trim(); if (value) void run(() => props.onCreateModule(props.color, value, '', activeProfile.id)) }}>New {props.color} module</button>
      {props.showGlobalLibrary !== false && <GlobalLibrary profile={activeProfile} busy={busy} run={run} {...props} />}
    </section>}
  </div>
}

function GlobalLibrary({ profile, busy, run, editingModuleId, editingLinePaths, color, onPinTemplate, onUnpinTemplate, onCopyTemplate, onCopyMissingTemplateLines, onPreviewTemplate }: Props & { profile: RepertoireProfileSummary; busy: boolean; run: (action: AsyncAction) => Promise<void> }) {
  const [templates, setTemplates] = useState<OpeningTemplateSummary[]>([])
  const [preview, setPreview] = useState<OpeningTemplateRelease | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { const controller = new AbortController(); listOpeningTemplates(controller.signal).then(setTemplates, (reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load the library.') }); return () => controller.abort() }, [])
  const pins = profile.templateReleases ?? []
  return <section className="global-library"><h4>Global opening library</h4>
    {error && <p className="panel-status error">{error}</p>}
    {templates.length === 0 && !error && <p className="panel-status">No published openings yet.</p>}
    {templates.map((template) => {
      const release = template.latestRelease
      const pinned = release ? pins.some((pin) => pin.id === release.id) : false
      return <div className="manager-row" key={template.slug}><span><strong>{template.name}</strong> <small>{template.color}{release ? ` · v${release.version}` : ''}</small></span>
        {release && <button disabled={busy} onClick={() => fetchOpeningTemplateRelease(template.slug, release.version).then((snapshot) => { setPreview(snapshot); onPreviewTemplate(snapshot) }, (reason) => setError(reason instanceof Error ? reason.message : 'Preview failed.'))}>Preview</button>}
        {release && (pinned ? <button disabled={busy} onClick={() => void run(() => onUnpinTemplate(profile.id, release.id))}>Unpin</button> : <button disabled={busy} onClick={() => void run(() => onPinTemplate(profile.id, release.id, pins.length))}>Add read-only</button>)}
        {release && <button disabled={busy} onClick={() => void run(() => onCopyTemplate(template.slug, release.version, profile.id))}>Copy editable</button>}
      </div>
    })}
    {preview && (() => {
      const missing = findMissingReleaseLines(preview.lines, editingLinePaths)
      return <div className="template-preview"><button aria-label="Close preview" onClick={() => { setPreview(null); onPreviewTemplate(null) }}>×</button><strong>{preview.name} v{preview.version}</strong>{preview.changelog && <p>{preview.changelog}</p>}<p>Previewed on the explorer · {preview.lines.length} lines · {Object.values(preview.tree).reduce((sum, moves) => sum + moves.length, 0)} moves</p>
        {preview.color === color && <><p><strong>{missing.length}</strong> of {preview.lines.length} lines are missing from the current editing module.</p>
          {missing.length > 0 && <ul>{missing.map((line) => <li key={line.id}>{line.label || line.steps.map((step) => step.san).join(' ')}</li>)}</ul>}
          {editingModuleId && <button disabled={busy || missing.length === 0} onClick={() => void run(() => onCopyMissingTemplateLines(preview.templateSlug, preview.version, editingModuleId))}>{missing.length === 0 ? 'No gaps' : `Fill ${missing.length} gap${missing.length === 1 ? '' : 's'}`}</button>}
        </>}
      </div>
    })()}
  </section>
}
