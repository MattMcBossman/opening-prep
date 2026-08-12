import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  fetchOpeningTemplateRelease,
  listOpeningTemplates,
  publishOpeningTemplate,
  type OpeningTemplateRelease,
  type OpeningTemplateSummary,
  type RepertoireProfileSummary,
  type RepertoireSummary,
} from '../lib/repertoireApi'
import type { RepertoireColor, RepertoireTree } from '../types'
import { findResponseConflicts } from '../lib/repertoireTree'
import { findMissingReleaseLines } from '../lib/repertoireOverlay'
import { validateManagementName } from '../lib/managementValidation'
import './RepertoireProfileControls.css'

type AsyncAction = () => Promise<unknown>

type Props = {
  profiles: RepertoireProfileSummary[]
  modules: RepertoireSummary[]
  activeProfileId: number | null
  editingModuleId: number | null
  editingLinePaths: string[]
  editingTree: RepertoireTree
  color: RepertoireColor
  disabled?: boolean
  showGlobalLibrary?: boolean
  canManageGlobalLibrary?: boolean
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
  previewRelease: OpeningTemplateRelease | null
  onPreviewTemplate: (release: OpeningTemplateRelease | null) => void
}

export function RepertoireProfileControls(props: Props) {
  const { profiles, activeProfileId, editingModuleId, color, disabled = false, onProfileChange, onEditingModuleChange } = props
  const [managing, setManaging] = useState(false)
  const manageButtonRef = useRef<HTMLButtonElement>(null)
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? null
  const editableModules = activeProfile?.modules.filter((module) => module.enabled && module.color === color) ?? []

  if (profiles.length === 0) return null

  const closeManager = () => {
    setManaging(false)
    requestAnimationFrame(() => manageButtonRef.current?.focus())
  }

  return (
    <div className="repertoire-profile-controls" aria-label="Repertoire profile and editing module">
      <label><span>Profile</span><select value={activeProfileId ?? ''} disabled={disabled} onChange={(event) => onProfileChange(Number(event.target.value))}>
        {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
      </select></label>
      <label><span>Editing</span><select value={editingModuleId ?? ''} disabled={disabled || editableModules.length === 0} onChange={(event) => onEditingModuleChange(Number(event.target.value))}>
        {editableModules.length === 0 ? <option value="">No {color} module</option> : editableModules.map((module) => <option key={module.id} value={module.id}>{module.name}</option>)}
      </select></label>
      <button ref={manageButtonRef} type="button" className="profile-manage-button" aria-expanded={managing} aria-haspopup="dialog" onClick={() => managing ? closeManager() : setManaging(true)}>Manage</button>
      {managing && createPortal(
        <div className="profile-manager-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeManager() }}>
          <ProfileManager {...props} activeProfile={activeProfile} onClose={closeManager} />
        </div>,
        document.body,
      )}
    </div>
  )
}

function ProfileManager({ activeProfile, onClose, ...props }: Props & { activeProfile: RepertoireProfileSummary | null; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const headingId = useId()
  const [profileName, setProfileName] = useState('')
  const [profileRename, setProfileRename] = useState<string | null>(null)
  const [moduleName, setModuleName] = useState('')
  const [moduleRename, setModuleRename] = useState<{ id: number; name: string } | null>(null)
  const [publishDraft, setPublishDraft] = useState<{ moduleId: number; changelog: string } | null>(null)
  const [libraryRevision, setLibraryRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const dialog = dialogRef.current
    dialog?.querySelector<HTMLElement>('button, input, select')?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')]
      if (focusable.length === 0) return
      const first = focusable[0]; const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', onKeyDown) }
  }, [])

  const run = async (action: AsyncAction) => {
    setBusy(true); setLocalError(null)
    try { await action(); return true } catch (error) { setLocalError(error instanceof Error ? error.message : 'The change could not be saved.'); return false } finally { setBusy(false) }
  }
  const submitName = async (value: string, names: string[], action: (trimmed: string) => Promise<unknown>, currentName?: string) => {
    const error = validateManagementName(value, names, currentName)
    if (error) { setLocalError(error); return false }
    return run(() => action(value.trim()))
  }

  return <div ref={dialogRef} className="profile-manager" role="dialog" aria-modal="true" aria-labelledby={headingId}>
    <div className="profile-manager-heading"><strong id={headingId}>Profiles &amp; opening modules</strong><button type="button" className="profile-manager-close" onClick={onClose} aria-label="Close profile manager">×</button></div>
    {localError && <p className="panel-status error" role="alert">{localError}</p>}
    <form className="manager-form" onSubmit={(event) => { event.preventDefault(); void submitName(profileName, props.profiles.map(({ name }) => name), props.onCreateProfile).then((saved) => { if (saved) setProfileName('') }) }}>
      <label htmlFor="new-profile-name">New profile</label>
      <div className="manager-form-actions"><input id="new-profile-name" type="text" maxLength={100} placeholder="e.g. Tournament" value={profileName} onChange={(event) => setProfileName(event.target.value)} /><button type="submit" disabled={busy}>Create</button></div>
    </form>
    {activeProfile && <section aria-labelledby="active-profile-heading">
      <div className="manager-section-heading"><div><h3 id="active-profile-heading">{activeProfile.name}</h3><small>Active profile · combines the modules listed below</small></div>
        <div className="manager-actions"><button type="button" disabled={busy} onClick={() => setProfileRename(activeProfile.name)}>Rename profile</button>
          {props.profiles.length > 1 && <button type="button" className="danger" disabled={busy} onClick={() => { if (window.confirm(`Delete profile “${activeProfile.name}”? Its modules will be kept.`)) void run(() => props.onDeleteProfile(activeProfile.id)) }}>Delete profile</button>}</div>
      </div>
      {profileRename !== null && <form className="manager-inline-form" onSubmit={(event) => { event.preventDefault(); void submitName(profileRename, props.profiles.map(({ name }) => name), (value) => props.onRenameProfile(activeProfile.id, value), activeProfile.name).then((saved) => { if (saved) setProfileRename(null) }) }}>
        <label htmlFor="rename-profile-name">Profile name</label><input id="rename-profile-name" type="text" maxLength={100} autoFocus value={profileRename} onChange={(event) => setProfileRename(event.target.value)} />
        <div className="manager-actions"><button type="submit" disabled={busy}>Save name</button><button type="button" onClick={() => setProfileRename(null)}>Cancel</button></div>
      </form>}
      <h4>Personal opening modules</h4>
      <div className="manager-card-list">{props.modules.map((module) => {
        const membership = activeProfile.modules.find((candidate) => candidate.id === module.id)
        const membershipIndex = membership ? activeProfile.modules.findIndex((candidate) => candidate.id === module.id) : -1
        const moveMembership = async (offset: -1 | 1) => {
          if (!membership) return
          const other = activeProfile.modules[membershipIndex + offset]
          if (!other) return
          await props.onSetMembership(activeProfile.id, other.id, membership.sortOrder, other.enabled)
          await props.onSetMembership(activeProfile.id, module.id, other.sortOrder, membership.enabled)
        }
        const isEditing = props.editingModuleId === module.id
        const preparedLineCount = Number.isFinite(module.lineCount) ? module.lineCount : (membership?.lineCount ?? 0)
        return <article className="manager-card" key={module.id}>
          <div className="manager-card-title"><span><strong>{module.name}</strong><small className="manager-card-meta"><span>{module.color}</span><span>Personal</span><span>{preparedLineCount} prepared line{preparedLineCount === 1 ? '' : 's'}</span><span>{module.moveCount} saved move{module.moveCount === 1 ? '' : 's'}</span></small>{module.hasResponseConflicts && <small className="panel-status error">Needs response cleanup</small>}</span><span className="manager-status">{membership ? (membership.enabled ? 'In profile' : 'Paused') : 'Not attached'}</span></div>
          {moduleRename?.id === module.id && <form className="manager-inline-form" onSubmit={(event) => { event.preventDefault(); void submitName(moduleRename.name, props.modules.map(({ name }) => name), (value) => props.onRenameModule(module.id, value), module.name).then((saved) => { if (saved) setModuleRename(null) }) }}>
            <label htmlFor={`rename-module-${module.id}`}>Module name</label><input id={`rename-module-${module.id}`} type="text" maxLength={100} autoFocus value={moduleRename.name} onChange={(event) => setModuleRename({ id: module.id, name: event.target.value })} />
            <div className="manager-actions"><button type="submit" disabled={busy}>Save name</button><button type="button" onClick={() => setModuleRename(null)}>Cancel</button></div>
          </form>}
          <div className="manager-actions manager-membership-actions">
            {membership ? <><label className="manager-enabled"><input type="checkbox" checked={membership.enabled} onChange={(event) => void run(() => props.onSetMembership(activeProfile.id, module.id, membership.sortOrder, event.target.checked))} /> Included</label>
              <button type="button" aria-label={`Move ${module.name} earlier`} disabled={busy || membershipIndex === 0} onClick={() => void run(() => moveMembership(-1))}>Move up</button>
              <button type="button" aria-label={`Move ${module.name} later`} disabled={busy || membershipIndex === activeProfile.modules.length - 1} onClick={() => void run(() => moveMembership(1))}>Move down</button>
              <button type="button" disabled={busy} onClick={() => void run(() => props.onRemoveMembership(activeProfile.id, module.id))}>Detach</button></> : <button type="button" disabled={busy} onClick={() => void run(() => props.onSetMembership(activeProfile.id, module.id, activeProfile.modules.length, true))}>Attach to profile</button>}
            {membership?.enabled && module.color === props.color && <button type="button" className={isEditing ? 'selected-action' : ''} aria-pressed={isEditing} disabled={busy || isEditing} onClick={() => props.onEditingModuleChange(module.id)}>{isEditing ? 'Editing this module' : 'Edit lines here'}</button>}
          </div>
          <div className="manager-actions manager-secondary-actions">{props.canManageGlobalLibrary && <button type="button" disabled={busy || preparedLineCount === 0 || module.hasResponseConflicts} title={module.hasResponseConflicts ? "Resolve multiple responses before publishing" : undefined} onClick={() => setPublishDraft({ moduleId: module.id, changelog: '' })}>Publish to community</button>}<button type="button" disabled={busy} onClick={() => setModuleRename({ id: module.id, name: module.name })}>Rename</button><button type="button" className="danger" disabled={busy} onClick={() => { if (window.confirm(`Delete module “${module.name}” and all of its lines?`)) void run(() => props.onDeleteModule(module.id)) }}>Delete module</button></div>
          {publishDraft?.moduleId === module.id && <form className="manager-inline-form publish-confirmation" onSubmit={(event) => { event.preventDefault(); void run(() => publishOpeningTemplate(module.id, publishDraft.changelog)).then((saved) => { if (saved) { setPublishDraft(null); setLibraryRevision((value) => value + 1) } }) }}>
            <strong>Publish “{module.name}” publicly?</strong>
            <p>This creates an immutable release in the Community library under your account. It will not be labeled as an official Mainline module.</p>
            {module.description && <p>{module.description}</p>}
            <label htmlFor="publish-changelog">What changed? <span>(optional)</span></label><textarea id="publish-changelog" maxLength={1000} value={publishDraft.changelog} onChange={(event) => setPublishDraft({ moduleId: module.id, changelog: event.target.value })} />
            <div className="manager-actions"><button type="submit" disabled={busy}>Confirm public release</button><button type="button" disabled={busy} onClick={() => setPublishDraft(null)}>Cancel</button></div>
          </form>}
        </article>
      })}</div>
      <form className="manager-form" onSubmit={(event) => { event.preventDefault(); void submitName(moduleName, props.modules.map(({ name }) => name), (value) => props.onCreateModule(props.color, value, '', activeProfile.id)).then((saved) => { if (saved) setModuleName('') }) }}>
        <label htmlFor="new-module-name">New {props.color} opening module</label><div className="manager-form-actions"><input id="new-module-name" type="text" maxLength={100} placeholder={`e.g. ${props.color === 'white' ? 'Vienna Game' : 'Sicilian Defense'}`} value={moduleName} onChange={(event) => setModuleName(event.target.value)} /><button type="submit" disabled={busy}>Create module</button></div>
      </form>
      {props.showGlobalLibrary !== false && <GlobalLibrary libraryRevision={libraryRevision} profile={activeProfile} busy={busy} run={run} {...props} />}
    </section>}
  </div>
}

function GlobalLibrary({ libraryRevision, profile, busy, run, editingModuleId, editingLinePaths, editingTree, color, canManageGlobalLibrary = true, onPinTemplate, onUnpinTemplate, onCopyTemplate, onCopyMissingTemplateLines, previewRelease, onPreviewTemplate }: Props & { profile: RepertoireProfileSummary; busy: boolean; run: (action: AsyncAction) => Promise<boolean>; libraryRevision: number }) {
  const [templates, setTemplates] = useState<OpeningTemplateSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { const controller = new AbortController(); listOpeningTemplates(controller.signal).then(setTemplates, (reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load the library.') }); return () => controller.abort() }, [libraryRevision])
  const pins = profile.templateReleases ?? []
  const canManage = canManageGlobalLibrary
  return <section className="global-library"><h4>Global opening library</h4><p className="manager-help">Published releases can be loaded read-only without signing in. Sign in to attach one permanently or copy it as an editable module.</p>
    {error && <p className="panel-status error">{error}</p>}
    {templates.length === 0 && !error && <p className="panel-status">No published openings yet.</p>}
    <div className="manager-card-list">{templates.slice().sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "official" ? -1 : 1).map((template) => {
      const release = template.latestRelease
      const pinned = release ? pins.some((pin) => pin.id === release.id) : false
      return <article className="manager-card global-module-card" key={template.slug}><div className="manager-card-title"><span><strong>{template.name}</strong><small>{template.kind === 'official' ? 'Official · Mainline' : 'Community · ' + template.publisherName} · {template.color}{release ? ' · release v' + release.version : ' · no published release'}</small></span>{pinned && <span className="manager-status">In profile · read-only</span>}</div>
        {release && <div className="manager-actions"><button type="button" disabled={busy} onClick={() => fetchOpeningTemplateRelease(template.slug, release.version).then((snapshot) => { onPreviewTemplate(snapshot) }, (reason) => setError(reason instanceof Error ? reason.message : 'Load failed.'))}>View module</button>
          {canManage && (pinned ? <button type="button" disabled={busy} onClick={() => void run(() => onUnpinTemplate(profile.id, release.id))}>Remove read-only</button> : <button type="button" disabled={busy} onClick={() => void run(() => onPinTemplate(profile.id, release.id, pins.length))}>Add read-only</button>)}
          {canManage && <button type="button" disabled={busy} onClick={() => void run(() => onCopyTemplate(template.slug, release.version, profile.id))}>Copy as editable</button>}</div>}
      </article>
    })}</div>
    {previewRelease && (() => {
      const missing = findMissingReleaseLines(previewRelease.lines, editingLinePaths)
      const conflicting = missing.filter((line) => findResponseConflicts(editingTree, color, line.steps).length > 0)
      const fillable = missing.length - conflicting.length
      const previewPin = pins.find((pin) => pin.id === previewRelease.id)
      return <div className="template-preview"><button type="button" aria-label="Unload global module" onClick={() => onPreviewTemplate(null)}>×</button><strong>{previewRelease.name} v{previewRelease.version}</strong><small>Loaded globally · read-only</small><div className="manager-actions">{canManage && (previewPin ? <button type="button" disabled={busy} onClick={() => void run(() => onUnpinTemplate(profile.id, previewRelease.id))}>Remove read-only from profile</button> : <button type="button" disabled={busy} onClick={() => void run(() => onPinTemplate(profile.id, previewRelease.id, pins.length))}>Add read-only to profile</button>)}{canManage && <button type="button" disabled={busy} onClick={() => void run(() => onCopyTemplate(previewRelease.templateSlug, previewRelease.version, profile.id))}>Copy as new personal module</button>}</div>{previewRelease.changelog && <p>{previewRelease.changelog}</p>}<p>Loaded in the explorer · {previewRelease.lines.length} lines · {Object.values(previewRelease.tree).reduce((sum, moves) => sum + moves.length, 0)} moves</p>
        {previewRelease.color === color && <><p><strong>{missing.length}</strong> of {previewRelease.lines.length} lines are missing from the current editing module.</p>{conflicting.length > 0 && <p className="panel-status error">{conflicting.length} conflicting line(s) will be skipped. Copy this release as a new module to keep those alternative responses.</p>}
          {missing.length > 0 && <ul>{missing.map((line) => <li key={line.id}>{line.label || line.steps.map((step) => step.san).join(' ')}</li>)}</ul>}
          {canManage && editingModuleId && <button type="button" disabled={busy || fillable === 0} onClick={() => void run(() => onCopyMissingTemplateLines(previewRelease.templateSlug, previewRelease.version, editingModuleId))}>{fillable === 0 ? 'No non-conflicting gaps to fill' : `Fill  non-conflicting gap(s)`}</button>}
        </>}
      </div>
    })()}
  </section>
}
