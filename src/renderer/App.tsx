import { useEffect, useMemo, useRef, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useStore } from './store'
import { TerminalPane } from './components/TerminalPane'
import { FileTree } from './components/FileTree'
import { EditorPane, type EditorPaneHandle } from './components/EditorPane'
import { CommitDialog } from './components/CommitDialog'
import { PushDialog } from './components/PushDialog'
import { OnboardingDialog } from './components/OnboardingDialog'
import type { EditorPane as EditorPaneData, GitStatus } from '../shared/config'
import { useGitStatus } from './use-git-status'

function HSplitHandle(): JSX.Element {
  return <PanelResizeHandle className="hsplit-handle" />
}
function VSplitHandle(): JSX.Element {
  return <PanelResizeHandle className="vsplit-handle" />
}

export default function App(): JSX.Element {
  const config = useStore((s) => s.config)
  const setConfig = useStore((s) => s.setConfig)
  const patchConfig = useStore((s) => s.patchConfig)
  const setProjectRoot = useStore((s) => s.setProjectRoot)
  const projectRoot = useStore((s) => s.projectRoot)
  const setLayout = useStore((s) => s.setLayout)
  const setConsultantExplorerVisible = useStore((s) => s.setConsultantExplorerVisible)
  const setDeveloperExplorerVisible = useStore((s) => s.setDeveloperExplorerVisible)
  const setEditorPane = useStore((s) => s.setEditorPane)
  const consultantSelection = useStore((s) => s.consultantSelection)
  const developerSelection = useStore((s) => s.developerSelection)
  const setConsultantSelection = useStore((s) => s.setConsultantSelection)
  const setDeveloperSelection = useStore((s) => s.setDeveloperSelection)

  const [gitDialog, setGitDialog] = useState<'commit' | 'push' | null>(null)
  const [notesAppend, setNotesAppend] = useState<{ seq: number; text: string } | null>(null)

  const gitCwd = config?.developer_dir ?? null
  const { status: gitStatus, refresh: refreshGit } = useGitStatus(gitCwd)

  const editorRefs = useRef<Map<string, EditorPaneHandle | null>>(new Map())
  const editorRefCbs = useRef<Map<string, (h: EditorPaneHandle | null) => void>>(new Map())

  function registerEditor(id: string): (h: EditorPaneHandle | null) => void {
    let cb = editorRefCbs.current.get(id)
    if (!cb) {
      cb = (h: EditorPaneHandle | null): void => {
        if (h) editorRefs.current.set(id, h)
        else editorRefs.current.delete(id)
      }
      editorRefCbs.current.set(id, cb)
    }
    return cb
  }

  // Three-way dirty prompt: Save / Don't Save / Cancel.
  // Returns true if the caller should proceed with the action, false if the
  // user cancelled (or Save failed — in which case we keep the pane open so
  // nothing is silently discarded).
  async function promptDirtyBeforeAction(paneId: string, action: string): Promise<boolean> {
    const h = editorRefs.current.get(paneId)
    if (!h || !h.isDirty()) return true
    const label = h.displayName() || paneId
    const choice = await window.api.dialog.confirmUnsaved({ name: label, action })
    if (choice === 'cancel') return false
    if (choice === 'discard') return true
    const r = await h.save()
    return r.ok
  }

  // Bootstrap: load config + project root.
  useEffect(() => {
    let cancelled = false
    Promise.all([window.api.config.load(), window.api.app.getProjectRoot()])
      .then(([cfg, root]) => {
        if (cancelled) return
        setConfig(cfg)
        setProjectRoot(root)
      })
      .catch((err) => {
        console.error('Failed to bootstrap config', err)
      })
    return () => { cancelled = true }
  }, [setConfig, setProjectRoot])

  // Guard window close when any editor is dirty. Electron fires beforeunload
  // for reload, close-button, and normal app quit (including Cmd+Q and
  // app.quit()); cancelling here aborts the quit. Forced app.exit(), crashes,
  // and OS shutdown/logout bypass beforeunload and remain unprotected.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent): void {
      const anyDirty = Array.from(editorRefs.current.values()).some((h) => !!h && h.isDirty())
      if (anyDirty) {
        e.preventDefault()
        e.returnValue = 'You have unsaved editor changes.'
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  if (!config) {
    return (
      <div className="app">
        <div className="app-header">
          <div className="title">ArchiDev-Flow</div>
        </div>
        <div style={{ padding: 16, color: 'var(--text-2)' }}>Loading…</div>
      </div>
    )
  }

  if (!config.onboardingComplete) {
    return (
      <div className="app">
        <div className="app-header">
          <div className="title">ArchiDev-Flow</div>
        </div>
        <OnboardingDialog
          projectRoot={projectRoot || config.developer_dir}
          initialConsultantDir={config.consultant_dir || projectRoot}
          onComplete={({ consultant_tool, developer_tool, consultant_dir }) => {
            patchConfig({
              consultant_tool,
              developer_tool,
              consultant_dir,
              developer_dir: projectRoot || config.developer_dir,
              onboardingComplete: true
            })
          }}
        />
      </div>
    )
  }

  function sendTerminalToOther(sourceId: 'consultant' | 'developer'): void {
    const text = sourceId === 'consultant' ? consultantSelection : developerSelection
    if (!text) return
    const targetAttr = sourceId === 'consultant' ? 'developer' : 'consultant'
    const host = document.querySelector(`[data-terminal-id="${targetAttr}"] .xterm-host`)
    if (host) {
      host.dispatchEvent(new CustomEvent('archidev:paste', { detail: text }))
    }
  }

  function sendTerminalToNotes(sourceId: 'consultant' | 'developer'): void {
    const text = sourceId === 'consultant' ? consultantSelection : developerSelection
    if (!text) return
    setNotesAppend({ seq: Date.now(), text })
  }

  const developerEditor = config.editors.find((e) => e.id === 'file')
  const consultantEditor = config.editors.find((e) => e.id === 'consultantFile')

  async function openFileInDeveloperPane(path: string): Promise<void> {
    if (!developerEditor) return
    if (!(await promptDirtyBeforeAction('file', 'open the new file'))) return
    setEditorPane('file', { filePath: path })
  }
  async function openFileInConsultantPane(path: string): Promise<void> {
    const target = consultantEditor ? 'consultantFile' : 'file'
    if (!(await promptDirtyBeforeAction(target, 'open the new file'))) return
    setEditorPane(target, { filePath: path })
  }
  async function toggleConsultantExplorer(): Promise<void> {
    if (!config) return
    const next = !config.consultantExplorerVisible
    // Turning off removes the consultantFile pane; prompt if it has unsaved edits.
    if (!next && !(await promptDirtyBeforeAction('consultantFile', 'close the consultant file editor'))) {
      return
    }
    setConsultantExplorerVisible(next)
  }
  function toggleDeveloperExplorer(): void {
    if (!config) return
    setDeveloperExplorerVisible(!config.developerExplorerVisible)
  }
  function changeNotesPath(newPath: string): void {
    patchConfig({ notesPath: newPath })
  }

  return (
    <div className="app">
      <div className="app-header">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div className="title">ArchiDev-Flow</div>
          <div className="sub">{projectRoot}</div>
        </div>
        <div className="actions">
          <GitActions
            status={gitStatus}
            onOpenCommit={() => setGitDialog('commit')}
            onOpenPush={() => setGitDialog('push')}
          />
        </div>
      </div>

      <div className="app-body">
        <PanelGroup
          direction="vertical"
          onLayout={(sizes) => setLayout({ mainVertical: [sizes[0], sizes[1]] })}
        >
          <Panel defaultSize={config.layout.mainVertical[0]} minSize={20}>
            <PanelGroup
              direction="horizontal"
              onLayout={(sizes) => setLayout({ topHorizontal: [sizes[0], sizes[1]] })}
            >
              <Panel defaultSize={config.layout.topHorizontal[0]} minSize={20}>
                {config.consultantExplorerVisible ? (
                  <PanelGroup
                    direction="horizontal"
                    onLayout={(sizes) => setLayout({ consultantInner: [sizes[0], sizes[1]] })}
                  >
                    <Panel defaultSize={config.layout.consultantInner[0]} minSize={10}>
                      <FileTree
                        root={config.consultant_dir}
                        label="Consultant Files"
                        onOpenFile={openFileInConsultantPane}
                      />
                    </Panel>
                    <HSplitHandle />
                    <Panel defaultSize={config.layout.consultantInner[1]} minSize={20}>
                      <TerminalPane
                        id="consultant"
                        label="Consultant"
                        cwd={config.consultant_dir}
                        command={config.consultant_tool}
                        onSelectionChange={setConsultantSelection}
                        onSendToOther={() => sendTerminalToOther('consultant')}
                        onSendToNotes={() => sendTerminalToNotes('consultant')}
                        leadingTool={
                          <ExplorerToggleButton
                            side="consultant"
                            visible={true}
                            onClick={() => void toggleConsultantExplorer()}
                          />
                        }
                      />
                    </Panel>
                  </PanelGroup>
                ) : (
                  <TerminalPane
                    id="consultant"
                    label="Consultant"
                    cwd={config.consultant_dir}
                    command={config.consultant_tool}
                    onSelectionChange={setConsultantSelection}
                    onSendToOther={() => sendTerminalToOther('consultant')}
                    onSendToNotes={() => sendTerminalToNotes('consultant')}
                    leadingTool={
                      <ExplorerToggleButton
                        side="consultant"
                        visible={false}
                        onClick={() => void toggleConsultantExplorer()}
                      />
                    }
                  />
                )}
              </Panel>

              <HSplitHandle />

              <Panel defaultSize={config.layout.topHorizontal[1]} minSize={20}>
                {config.developerExplorerVisible ? (
                  <PanelGroup
                    direction="horizontal"
                    onLayout={(sizes) => setLayout({ developerInner: [sizes[0], sizes[1]] })}
                  >
                    <Panel defaultSize={config.layout.developerInner[0]} minSize={10}>
                      <FileTree
                        root={config.developer_dir}
                        label="Project Files"
                        onOpenFile={openFileInDeveloperPane}
                      />
                    </Panel>
                    <HSplitHandle />
                    <Panel defaultSize={config.layout.developerInner[1]} minSize={20}>
                      <TerminalPane
                        id="developer"
                        label="Developer"
                        cwd={config.developer_dir}
                        command={config.developer_tool}
                        onSelectionChange={setDeveloperSelection}
                        onSendToOther={() => sendTerminalToOther('developer')}
                        onSendToNotes={() => sendTerminalToNotes('developer')}
                        leadingTool={
                          <ExplorerToggleButton
                            side="developer"
                            visible={true}
                            onClick={toggleDeveloperExplorer}
                          />
                        }
                      />
                    </Panel>
                  </PanelGroup>
                ) : (
                  <TerminalPane
                    id="developer"
                    label="Developer"
                    cwd={config.developer_dir}
                    command={config.developer_tool}
                    onSelectionChange={setDeveloperSelection}
                    onSendToOther={() => sendTerminalToOther('developer')}
                    onSendToNotes={() => sendTerminalToNotes('developer')}
                    leadingTool={
                      <ExplorerToggleButton
                        side="developer"
                        visible={false}
                        onClick={toggleDeveloperExplorer}
                      />
                    }
                  />
                )}
              </Panel>
            </PanelGroup>
          </Panel>

          <VSplitHandle />

          <Panel defaultSize={config.layout.mainVertical[1]} minSize={15}>
            <BottomEditors
              panes={config.editors}
              initialSizes={config.layout.bottomHorizontal}
              onLayout={(sizes) => setLayout({ bottomHorizontal: sizes })}
              notesAppend={notesAppend}
              registerEditor={registerEditor}
              onChangeNotesPath={changeNotesPath}
            />
          </Panel>
        </PanelGroup>
      </div>

      {gitDialog === 'commit' && gitStatus && gitCwd && (
        <CommitDialog
          cwd={gitCwd}
          status={gitStatus}
          onClose={() => setGitDialog(null)}
          onCommitted={() => void refreshGit()}
        />
      )}
      {gitDialog === 'push' && gitStatus && gitCwd && (
        <PushDialog
          cwd={gitCwd}
          status={gitStatus}
          onClose={() => setGitDialog(null)}
          onPushed={() => void refreshGit()}
        />
      )}
    </div>
  )
}

function GitActions({
  status,
  onOpenCommit,
  onOpenPush
}: {
  status: GitStatus | null
  onOpenCommit: () => void
  onOpenPush: () => void
}): JSX.Element {
  if (!status || !status.isRepo) {
    return <span className="branch-chip branch-chip-muted" title="Not a git repository">no repo</span>
  }
  const hasPending = status.tracked.length > 0 || status.untracked.length > 0
  const needsPublish = !status.detached && !status.upstream
  const canPush = !!status.upstream && status.ahead > 0
  const pushDisabled = status.detached || (!needsPublish && !canPush)

  const branchLabel = status.branch ?? '(unknown)'
  const pending = status.tracked.length + status.untracked.length
  const chipTitle = [
    status.detached ? 'Detached HEAD' : `Branch: ${branchLabel}`,
    status.upstream ? `Upstream: ${status.upstream}` : 'No upstream',
    status.upstream ? `Ahead ${status.ahead}, behind ${status.behind}` : null,
    `Pending: ${pending} file${pending === 1 ? '' : 's'}`
  ]
    .filter(Boolean)
    .join(' · ')

  const pushTitle = status.detached
    ? 'Cannot push from detached HEAD'
    : needsPublish
      ? `Publish to origin/${branchLabel}`
      : !canPush
        ? 'Nothing to push'
        : `Push ${status.ahead} commit${status.ahead === 1 ? '' : 's'} to ${status.upstream}`

  return (
    <>
      <span className="branch-chip" title={chipTitle}>
        <span className="branch-chip-icon" aria-hidden="true">⎇</span>
        <span className="branch-chip-name">{branchLabel}</span>
        {status.detached && <span className="branch-chip-tag">detached</span>}
        {hasPending && <span className="branch-chip-dot" aria-label="pending changes">●</span>}
        {status.upstream && status.ahead > 0 && (
          <span className="branch-chip-ahead">↑{status.ahead}</span>
        )}
        {status.upstream && status.behind > 0 && (
          <span className="branch-chip-behind">↓{status.behind}</span>
        )}
        {!status.upstream && !status.detached && (
          <span className="branch-chip-tag">no upstream</span>
        )}
      </span>
      <button
        onClick={onOpenCommit}
        disabled={!hasPending}
        title={
          hasPending
            ? `Commit ${pending} file${pending === 1 ? '' : 's'} on ${branchLabel}`
            : 'No pending changes'
        }
      >
        Commit
      </button>
      <button
        onClick={onOpenPush}
        disabled={pushDisabled}
        title={pushTitle}
      >
        {needsPublish ? 'Publish' : 'Push'}
      </button>
    </>
  )
}

function BottomEditors({
  panes,
  initialSizes,
  onLayout,
  notesAppend,
  registerEditor,
  onChangeNotesPath
}: {
  panes: EditorPaneData[]
  initialSizes: number[]
  onLayout: (sizes: number[]) => void
  notesAppend: { seq: number; text: string } | null
  registerEditor: (id: string) => (h: EditorPaneHandle | null) => void
  onChangeNotesPath: (newPath: string) => void
}): JSX.Element {
  const setEditorPane = useStore((s) => s.setEditorPane)
  const config = useStore((s) => s.config)!
  const notesPath = config.notesPath

  const defaultSizes = useMemo(() => {
    if (initialSizes.length === panes.length) return initialSizes
    const even = Math.round(100 / panes.length)
    return panes.map(() => even)
  }, [panes.length, initialSizes])

  return (
    <PanelGroup direction="horizontal" onLayout={onLayout}>
      {panes.map((pane, idx) => (
        <PaneWithHandle
          key={pane.id}
          isFirst={idx === 0}
          defaultSize={defaultSizes[idx] ?? Math.round(100 / panes.length)}
        >
          <EditorPane
            ref={registerEditor(pane.id)}
            pane={{
              ...pane,
              filePath: pane.isNotes ? notesPath : pane.filePath
            }}
            onRename={(name) => setEditorPane(pane.id, { name })}
            onChangeNotesPath={pane.isNotes ? onChangeNotesPath : undefined}
            externalAppend={pane.isNotes ? notesAppend : null}
          />
        </PaneWithHandle>
      ))}
    </PanelGroup>
  )
}

function PaneWithHandle({
  isFirst,
  defaultSize,
  children
}: {
  isFirst: boolean
  defaultSize: number
  children: React.ReactNode
}): JSX.Element {
  return (
    <>
      {!isFirst && <HSplitHandle />}
      <Panel defaultSize={defaultSize} minSize={10}>
        {children}
      </Panel>
    </>
  )
}

function ExplorerToggleButton({
  side,
  visible,
  onClick
}: {
  side: 'consultant' | 'developer'
  visible: boolean
  onClick: () => void
}): JSX.Element {
  const name = side === 'consultant' ? 'Consultant Files' : 'Project Files'
  const title = visible ? `Hide ${name}` : `Show ${name}`
  return (
    <button
      className={`explorer-toggle${visible ? ' on' : ''}`}
      onClick={onClick}
      aria-pressed={visible}
      aria-label={title}
      title={title}
    >
      <span className="explorer-toggle-chev" aria-hidden="true">{visible ? '◀' : '▶'}</span>
      <span className="explorer-toggle-text">Files</span>
    </button>
  )
}
