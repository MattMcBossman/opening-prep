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
import { validateManagementName } from '../lib/managementValidation'
import './RepertoireProfileControls.css'

type AsyncAction = () => Promise<unknown>

type Props = {
  context: 'explorer' | 'drill'
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
  onDuplicateModule: (id: number) => Promise<unknown>
  onDrillModule: (module: RepertoireSummary) => void
  onDeleteModule: (id: number) => Promise<unknown>
  onSetMembership: (profileId: number, moduleId: number, sortOrder: number, enabled: boolean) => Promise<unknown>
  onRemoveMembership: (profileId: number, moduleId: number) => Promise<unknown>
  onPinTemplate: (profileId: number, releaseId: number, sortOrder?: number) => Promise<unknown>
  onUnpinTemplate: (profileId: number, releaseId: number) => Promise<unknown>
  onCopyTemplate: (slug: string, version: number, profileId?: number) => Promise<unknown>
  onCopyMissingTemplateLines: (slug: string, version: number, moduleId: number) => Promise<unknown>
  previewRelease: OpeningTemplateRelease | null
  onPreviewTemplate: (release: OpeningTemplateRelease | null) => void
  workspaceMode: 'viewing' | 'editing'
  newModuleSelected: boolean
  hasUnsavedChanges: boolean
  onNewModule: () => void
  onEditModule: () => void
  onSaveModule: () => void
  onDiscardModuleChanges: () => void
}

export function RepertoireProfileControls(props: Props) {
  const { profiles, activeProfileId, editingModuleId, color, disabled = false, onProfileChange, onEditingModuleChange, previewRelease } = props
  const [managing, setManaging] = useState(false)
  const manageButtonRef = useRef<HTMLButtonElement>(null)
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? null
  const editableModules = props.modules.filter((module) => module.color === color)
  const isViewingRelease = previewRelease?.color === color
  const isEditing = props.workspaceMode === 'editing' && !isViewingRelease

  if (profiles.length === 0 && !disabled) return null

  const closeManager = () => {
    setManaging(false)
    requestAnimationFrame(() => manageButtonRef.current?.focus())
  }

  return (
    <div className="repertoire-profile-controls" aria-label="Repertoire profile and editing module">
      {props.context === 'drill' && <label><span>Profile</span><select value={activeProfileId ?? ''} disabled={disabled} onChange={(event) => onProfileChange(Number(event.target.value))}>
        {profiles.length === 0
          ? <option value="">Loading…</option>
          : profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
      </select></label>}
      {props.context === 'explorer' && <><label><span>{isEditing ? 'Editing' : 'Viewing'}</span><select value={isViewingRelease ? `release-${previewRelease.id}` : (props.newModuleSelected ? 'new' : (editingModuleId ?? 'new'))} disabled={disabled || isViewingRelease || (isEditing && (!props.newModuleSelected || props.hasUnsavedChanges))} onChange={(event) => event.target.value === 'new' ? props.onNewModule() : onEditingModuleChange(Number(event.target.value))}>
        {isViewingRelease
          ? <option value={`release-${previewRelease.id}`}>{previewRelease.name}</option>
          : profiles.length === 0
          ? <option value="">Loading…</option>
          : <><option value="new">New module…</option>{editableModules.map((module) => <option key={module.id} value={module.id}>{module.name}</option>)}</>}
      </select></label>
      {isViewingRelease
        ? <><button type="button" className="profile-manage-button" disabled={disabled} onClick={() => void props.onCopyTemplate(previewRelease.templateSlug, previewRelease.version, activeProfile?.id)}>Save copy</button><button type="button" className="profile-manage-button" disabled={disabled} onClick={() => props.onPreviewTemplate(null)}>Close</button></>
        : isEditing
          ? <><button type="button" className="profile-manage-button" disabled={disabled || !props.hasUnsavedChanges} onClick={props.onSaveModule}>Save</button><button type="button" className="profile-manage-button" disabled={disabled || (props.newModuleSelected && !props.hasUnsavedChanges)} onClick={props.onDiscardModuleChanges}>Discard</button></>
          : <button type="button" className="profile-manage-button" disabled={disabled || editingModuleId === null} onClick={props.onEditModule}>Edit</button>}</>}
      <button ref={manageButtonRef} type="button" className="profile-manage-button" disabled={disabled} aria-expanded={managing} aria-haspopup="dialog" onClick={() => managing ? closeManager() : setManaging(true)}>Manage</button>
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
  const [profilesOpen, setProfilesOpen] = useState(false)
  const [profileRename, setProfileRename] = useState<string | null>(null)
  const [moduleName, setModuleName] = useState('')
  const [moduleColor, setModuleColor] = useState<RepertoireColor>(props.color)
  const [managerView, setManagerView] = useState<'modules' | 'library'>('modules')
  const [moduleFilter, setModuleFilter] = useState<'all' | RepertoireColor>('all')
  const [moduleActionsId, setModuleActionsId] = useState<number | null>(null)
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

  const visibleModules = props.modules.filter((module) => moduleFilter === 'all' || module.color === moduleFilter)
  const isAttached = (moduleId: number) => Boolean(activeProfile?.modules.find((candidate) => candidate.id === moduleId)?.enabled)
  const attachedModules = visibleModules.filter((module) => isAttached(module.id))
  const otherModules = visibleModules.filter((module) => !isAttached(module.id))

  const renderModuleCard = (module: RepertoireSummary) => {
    if (!activeProfile) return null
    const membership = activeProfile.modules.find((candidate) => candidate.id === module.id)
    const attached = membership?.enabled ? membership : null
    const preparedLineCount = Number.isFinite(module.lineCount) ? module.lineCount : (membership?.lineCount ?? 0)
    const actionsOpen = moduleActionsId === module.id
    return <article className="manager-card" key={module.id}>
      <div className="manager-card-title"><span><span className="manager-module-heading"><strong>{module.name}</strong><span className={`opening-color-tag ${module.color}`}>{module.color}</span><span className="manager-module-start">{module.commonStart || 'No shared starting line'}</span></span><small className="manager-card-meta"><span>{preparedLineCount} prepared line{preparedLineCount === 1 ? '' : 's'}</span><span>{module.moveCount} saved move{module.moveCount === 1 ? '' : 's'}</span></small>{module.hasResponseConflicts && <small className="panel-status error">Needs response cleanup</small>}</span></div>
      {moduleRename?.id === module.id && <form className="manager-inline-form" onSubmit={(event) => { event.preventDefault(); void submitName(moduleRename.name, props.modules.map(({ name }) => name), (value) => props.onRenameModule(module.id, value), module.name).then((saved) => { if (saved) setModuleRename(null) }) }}>
        <label htmlFor={`rename-module-${module.id}`}>Module name</label><input id={`rename-module-${module.id}`} type="text" maxLength={100} autoFocus value={moduleRename.name} onChange={(event) => setModuleRename({ id: module.id, name: event.target.value })} />
        <div className="manager-actions"><button type="submit" disabled={busy}>Save name</button><button type="button" onClick={() => setModuleRename(null)}>Cancel</button></div>
      </form>}
      <div className="manager-actions manager-membership-actions">
        <button type="button" disabled={busy} onClick={() => { props.onEditingModuleChange(module.id); onClose() }}>View module</button>
        <button type="button" disabled={busy || preparedLineCount === 0} onClick={() => { props.onDrillModule(module); onClose() }}>Drill module</button>
        <button type="button" disabled={busy} onClick={() => void run(() => props.onDuplicateModule(module.id))}>Duplicate</button>
        {attached ? <button type="button" disabled={busy} onClick={() => void run(() => props.onRemoveMembership(activeProfile.id, module.id))}>Detach from profile</button> : <button type="button" disabled={busy} onClick={() => void run(() => props.onSetMembership(activeProfile.id, module.id, membership?.sortOrder ?? activeProfile.modules.length, true))}>Attach to profile</button>}
        <button type="button" className="manager-more-button" aria-expanded={actionsOpen} onClick={() => setModuleActionsId(actionsOpen ? null : module.id)}>More</button>
      </div>
      {actionsOpen && <div className="manager-actions manager-secondary-actions"><button type="button" disabled={busy} onClick={() => { setModuleRename({ id: module.id, name: module.name }); setModuleActionsId(null) }}>Rename</button>{props.canManageGlobalLibrary && <button type="button" disabled={busy || preparedLineCount === 0 || module.hasResponseConflicts} title={module.hasResponseConflicts ? "Resolve multiple responses before publishing" : undefined} onClick={() => { setPublishDraft({ moduleId: module.id, changelog: '' }); setModuleActionsId(null) }}>Publish to community</button>}<button type="button" className="danger" disabled={busy} onClick={() => { if (window.confirm(`Delete module “${module.name}” and all of its lines?`)) void run(() => props.onDeleteModule(module.id)); setModuleActionsId(null) }}>Delete module</button></div>}
      {publishDraft?.moduleId === module.id && <form className="manager-inline-form publish-confirmation" onSubmit={(event) => { event.preventDefault(); void run(() => publishOpeningTemplate(module.id, publishDraft.changelog)).then((saved) => { if (saved) { setPublishDraft(null); setLibraryRevision((value) => value + 1) } }) }}>
        <strong>Publish “{module.name}” publicly?</strong>
        <p>This creates an immutable release in the Community library under your account. It will not be labeled as an official Mainline module.</p>
        {module.description && <p>{module.description}</p>}
        <label htmlFor="publish-changelog">What changed? <span>(optional)</span></label><textarea id="publish-changelog" maxLength={1000} value={publishDraft.changelog} onChange={(event) => setPublishDraft({ moduleId: module.id, changelog: event.target.value })} />
        <div className="manager-actions"><button type="submit" disabled={busy}>Confirm public release</button><button type="button" disabled={busy} onClick={() => setPublishDraft(null)}>Cancel</button></div>
      </form>}
    </article>
  }

  return <div ref={dialogRef} className="profile-manager" role="dialog" aria-modal="true" aria-labelledby={headingId}>
    <div className="profile-manager-heading"><strong id={headingId}>Profiles &amp; opening modules</strong><button type="button" className="profile-manager-close" onClick={onClose} aria-label="Close profile manager">×</button></div>
    {localError && <p className="panel-status error" role="alert">{localError}</p>}
    <nav className="profile-manager-views" aria-label="Opening management views">
      <button type="button" className={managerView === 'modules' ? 'selected-action' : ''} aria-current={managerView === 'modules' ? 'page' : undefined} onClick={() => setManagerView('modules')}>My modules</button>
      {props.showGlobalLibrary !== false && <button type="button" className={managerView === 'library' ? 'selected-action' : ''} aria-current={managerView === 'library' ? 'page' : undefined} onClick={() => setManagerView('library')}>Module library</button>}
    </nav>
    {managerView === 'modules' && <>
    <button type="button" className="manager-profiles-toggle" aria-expanded={profilesOpen} onClick={() => setProfilesOpen((open) => !open)}>Manage profiles</button>
    {profilesOpen && <div className="manager-profiles-panel"><form className="manager-form" onSubmit={(event) => { event.preventDefault(); void submitName(profileName, props.profiles.map(({ name }) => name), props.onCreateProfile).then((saved) => { if (saved) setProfileName('') }) }}>
      <label htmlFor="new-profile-name">New profile</label>
      <div className="manager-form-actions"><input id="new-profile-name" type="text" maxLength={100} placeholder="e.g. Tournament" value={profileName} onChange={(event) => setProfileName(event.target.value)} /><button type="submit" disabled={busy}>Create</button></div>
    </form>
    {activeProfile && <>
      <div className="manager-section-heading"><div><h3 id="active-profile-heading">{activeProfile.name}</h3><small>Active profile · combines the modules listed below</small></div>
        <div className="manager-actions"><button type="button" disabled={busy} onClick={() => setProfileRename(activeProfile.name)}>Rename profile</button>
          {props.profiles.length > 1 && <button type="button" className="danger" disabled={busy} onClick={() => { if (window.confirm(`Delete profile “${activeProfile.name}”? Its modules will be kept.`)) void run(() => props.onDeleteProfile(activeProfile.id)) }}>Delete profile</button>}</div>
      </div>
      {profileRename !== null && <form className="manager-inline-form" onSubmit={(event) => { event.preventDefault(); void submitName(profileRename, props.profiles.map(({ name }) => name), (value) => props.onRenameProfile(activeProfile.id, value), activeProfile.name).then((saved) => { if (saved) setProfileRename(null) }) }}>
        <label htmlFor="rename-profile-name">Profile name</label><input id="rename-profile-name" type="text" maxLength={100} autoFocus value={profileRename} onChange={(event) => setProfileRename(event.target.value)} />
        <div className="manager-actions"><button type="submit" disabled={busy}>Save name</button><button type="button" onClick={() => setProfileRename(null)}>Cancel</button></div>
      </form>}
      </>}
      </div>}
    {activeProfile && <section aria-labelledby="active-profile-heading">
      <div className="manager-modules-heading"><h4>Opening modules</h4><div className="manager-color-filter" role="group" aria-label="Filter modules by color">{(['all', 'white', 'black'] as const).map((filter) => <button type="button" key={filter} className={moduleFilter === filter ? 'selected-action' : ''} aria-pressed={moduleFilter === filter} onClick={() => setModuleFilter(filter)}>{filter[0].toUpperCase() + filter.slice(1)}</button>)}</div></div>
      {attachedModules.length > 0 && <section className="manager-module-group"><h5>Attached to {activeProfile.name}</h5><div className="manager-card-list">{attachedModules.map(renderModuleCard)}</div></section>}
      {otherModules.length > 0 && <section className="manager-module-group"><h5>Other saved modules</h5><div className="manager-card-list">{otherModules.map(renderModuleCard)}</div></section>}
      {visibleModules.length === 0 && <p className="panel-status">No {moduleFilter === 'all' ? '' : `${moduleFilter} `}modules saved.</p>}
      <form className="manager-form" onSubmit={(event) => { event.preventDefault(); void submitName(moduleName, props.modules.map(({ name }) => name), (value) => props.onCreateModule(moduleColor, value, '', activeProfile.id)).then((saved) => { if (saved) setModuleName('') }) }}>
        <label htmlFor="new-module-name">New opening module</label><div className="manager-form-actions manager-create-module"><select aria-label="New module color" value={moduleColor} onChange={(event) => setModuleColor(event.target.value as RepertoireColor)}><option value="white">White</option><option value="black">Black</option></select><input id="new-module-name" type="text" maxLength={100} placeholder={moduleColor === 'white' ? 'e.g. Vienna Game' : 'e.g. Caro Kann'} value={moduleName} onChange={(event) => setModuleName(event.target.value)} /><button type="submit" disabled={busy}>Create module</button></div>
      </form>
    </section>}
    </>}
    {managerView === 'library' && activeProfile && <GlobalLibrary libraryRevision={libraryRevision} profile={activeProfile} busy={busy} run={run} onClose={onClose} {...props} />}
  </div>
}

function GlobalLibrary({ libraryRevision, profile, busy, run, onClose, canManageGlobalLibrary = true, onCopyTemplate, previewRelease, onPreviewTemplate }: Props & { profile: RepertoireProfileSummary; busy: boolean; run: (action: AsyncAction) => Promise<boolean>; libraryRevision: number; onClose: () => void }) {
  const [templates, setTemplates] = useState<OpeningTemplateSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { const controller = new AbortController(); listOpeningTemplates(controller.signal).then(setTemplates, (reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load the library.') }); return () => controller.abort() }, [libraryRevision])
  const pins = profile.templateReleases ?? []
  const canManage = canManageGlobalLibrary
  return <section className="global-library"><h4>Global opening library</h4><p className="manager-help">Preview a published module, open it read-only in the explorer, or save an editable personal copy.</p>
    {error && <p className="panel-status error">{error}</p>}
    {templates.length === 0 && !error && <p className="panel-status">No published openings yet.</p>}
    <div className="manager-card-list">{templates.slice().sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "official" ? -1 : 1).map((template) => {
      const release = template.latestRelease
      const pinned = release ? pins.some((pin) => pin.id === release.id) : false
      return <article className="manager-card global-module-card" key={template.slug}><div className="manager-card-title"><span><span className="manager-module-heading"><strong>{template.name}</strong><span className={`opening-color-tag ${template.color}`}>{template.color}</span>{release && <span className="manager-module-start">{release.commonStart || 'No shared starting line'}</span>}</span><small className="global-module-meta"><span>{template.kind === 'official' ? 'Official · Mainline' : 'Community · ' + template.publisherName}</span><span>{release ? 'Release v' + release.version : 'No published release'}</span>{release && <span>{release.lineCount} line{release.lineCount === 1 ? '' : 's'}</span>}</small></span>{pinned && <span className="manager-status">In profile · read-only</span>}</div>
        {release && <div className="manager-actions"><button type="button" disabled={busy} onClick={() => fetchOpeningTemplateRelease(template.slug, release.version).then((snapshot) => { onPreviewTemplate(snapshot) }, (reason) => setError(reason instanceof Error ? reason.message : 'Load failed.'))}>Preview</button>
          <button type="button" disabled={busy} onClick={() => fetchOpeningTemplateRelease(template.slug, release.version).then((snapshot) => { onPreviewTemplate(snapshot); onClose() }, (reason) => setError(reason instanceof Error ? reason.message : 'Load failed.'))}>View in explorer</button>
          {canManage && <button type="button" disabled={busy} onClick={() => void run(() => onCopyTemplate(template.slug, release.version, profile.id))}>Save copy</button>}</div>}
      </article>
    })}</div>
    {previewRelease && (() => {
      return <div className="template-preview"><button type="button" aria-label="Close module preview" onClick={() => onPreviewTemplate(null)}>×</button><strong>{previewRelease.name} v{previewRelease.version}</strong><small>Read-only preview</small><div className="manager-actions">{canManage && <button type="button" disabled={busy} onClick={() => void run(() => onCopyTemplate(previewRelease.templateSlug, previewRelease.version, profile.id))}>Save copy</button>}<button type="button" onClick={onClose}>View in explorer</button></div>{previewRelease.changelog && <p>{previewRelease.changelog}</p>}<p>{previewRelease.lines.length} lines · {Object.values(previewRelease.tree).reduce((sum, moves) => sum + moves.length, 0)} moves</p>
      </div>
    })()}
  </section>
}
