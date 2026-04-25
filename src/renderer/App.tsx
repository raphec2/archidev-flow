import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle
} from 'react-resizable-panels'
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
  const [editorAppend, setEditorAppend] = useState<
    { seq: number; paneId: string; text: string } | null
  >(null)

  const gitCwd = config?.developer_dir ?? null
  const { status: gitStatus, refresh: refreshGit } = useGitStatus(gitCwd)

  const editorRefs = useRef<Map<string, EditorPaneHandle | null>>(new Map())
  const editorRefCbs = useRef<Map<string, (h: EditorPaneHandle | null) => void>>(new Map())

  // Explorer panels stay mounted across visibility changes so the sibling
  // terminal Panel is never unregistered from react-resizable-panels (which
  // would unmount TerminalPane and kill its PTY). Visibility is applied via
  // the panel's own collapse/expand API instead of JSX membership.
  const consultantExplorerRef = useRef<ImperativePanelHandle | null>(null)
  const developerExplorerRef = useRef<ImperativePanelHandle | null>(null)

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

  // Drive explorer collapse state from the store without re-rendering
  // PanelGroup children. The visible state is the source of truth; the panel
  // ref is the effector. Guards against no-op expand/collapse loops.
  const consultantExplorerVisible = config?.consultantExplorerVisible
  const developerExplorerVisible = config?.developerExplorerVisible
  useEffect(() => {
    const panel = consultantExplorerRef.current
    if (!panel || consultantExplorerVisible === undefined) return
    if (consultantExplorerVisible && panel.isCollapsed()) panel.expand()
    else if (!consultantExplorerVisible && !panel.isCollapsed()) panel.collapse()
  }, [consultantExplorerVisible])
  useEffect(() => {
    const panel = developerExplorerRef.current
    if (!panel || developerExplorerVisible === undefined) return
    if (developerExplorerVisible && panel.isCollapsed()) panel.expand()
    else if (!developerExplorerVisible && !panel.isCollapsed()) panel.collapse()
  }, [developerExplorerVisible])

  // Quit-time three-way unsaved-change flow. Main vetoes window close and
  // sends `requestClose`; we walk each dirty pane through the same
  // Save / Don't Save / Cancel dialog used for switching and closing panes,
  // then respond once to release or hold the quit.
  //
  // - Save: runs the pane's normal save path; a failed save counts as cancel
  //   so nothing is silently dropped.
  // - Don't Save: discards for this quit only; buffers aren't rewritten.
  // - Cancel: we reply `false` and the window stays open with terminals alive.
  useEffect(() => {
    const off = window.api.app.onRequestClose(async () => {
      const ids = Array.from(editorRefs.current.keys())
      for (const id of ids) {
        const h = editorRefs.current.get(id)
        if (!h || !h.isDirty()) continue
        const label = h.displayName() || id
        const choice = await window.api.dialog.confirmUnsaved({
          name: label,
          action: 'quit ArchiDev-Flow'
        })
        if (choice === 'cancel') {
          window.api.app.respondClose(false)
          return
        }
        if (choice === 'save') {
          const r = await h.save()
          if (!r.ok) {
            window.api.app.respondClose(false)
            return
          }
        }
      }
      window.api.app.respondClose(true)
    })
    return off
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

  function pasteToTerminal(target: 'consultant' | 'developer', text: string): void {
    if (!text) return
    const host = document.querySelector(`[data-terminal-id="${target}"] .xterm-host`)
    if (host) {
      // TerminalPane's own archidev:paste handler performs the xterm paste and
      // focuses the destination terminal, so this call intentionally does not
      // duplicate either concern.
      host.dispatchEvent(new CustomEvent('archidev:paste', { detail: text }))
    }
  }

  function sendTerminalToOther(sourceId: 'consultant' | 'developer'): void {
    const text = sourceId === 'consultant' ? consultantSelection : developerSelection
    if (!text) return
    pasteToTerminal(sourceId === 'consultant' ? 'developer' : 'consultant', text)
  }

  function sendTerminalToEditor(
    sourceId: 'consultant' | 'developer',
    position: 'left' | 'right'
  ): void {
    if (!config) return
    const text = sourceId === 'consultant' ? consultantSelection : developerSelection
    if (!text) return
    const editors = config.editors
    const target = position === 'left' ? editors[0] : editors[editors.length - 1]
    if (!target) return
    setEditorAppend({ seq: Date.now(), paneId: target.id, text })
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
                <PanelGroup
                  key="consultant-inner"
                  direction="horizontal"
                  onLayout={(sizes) => {
                    // Skip persistence while the explorer is collapsed —
                    // otherwise [0, 100] would overwrite the real two-panel
                    // split the user expects back on re-open.
                    if (sizes.length === 2 && sizes[0] > 0) {
                      setLayout({ consultantInner: [sizes[0], sizes[1]] })
                    }
                  }}
                >
                  <Panel
                    key="consultant-explorer"
                    id="consultant-explorer"
                    order={1}
                    ref={consultantExplorerRef}
                    collapsible
                    collapsedSize={0}
                    defaultSize={
                      config.consultantExplorerVisible ? config.layout.consultantInner[0] : 0
                    }
                    minSize={10}
                    onCollapse={() => setConsultantExplorerVisible(false)}
                    onExpand={() => setConsultantExplorerVisible(true)}
                  >
                    <FileTree
                      root={config.consultant_dir}
                      label="Consultant Files"
                      onOpenFile={openFileInConsultantPane}
                    />
                  </Panel>
                  <PanelResizeHandle
                    className={`hsplit-handle${config.consultantExplorerVisible ? '' : ' hsplit-handle-hidden'}`}
                    disabled={!config.consultantExplorerVisible}
                  />
                  <Panel
                    key="consultant-terminal"
                    id="consultant-terminal"
                    order={2}
                    defaultSize={
                      config.consultantExplorerVisible ? config.layout.consultantInner[1] : 100
                    }
                    minSize={20}
                  >
                    <TerminalPane
                      id="consultant"
                      label="Consultant"
                      cwd={config.consultant_dir}
                      command={config.consultant_tool}
                      onSelectionChange={setConsultantSelection}
                      onSendToOther={() => sendTerminalToOther('consultant')}
                      onSendToLeftEditor={() => sendTerminalToEditor('consultant', 'left')}
                      onSendToRightEditor={() => sendTerminalToEditor('consultant', 'right')}
                      sideTool={
                        <ExplorerToggleButton
                          side="consultant"
                          visible={config.consultantExplorerVisible}
                          onClick={() => void toggleConsultantExplorer()}
                        />
                      }
                    />
                  </Panel>
                </PanelGroup>
              </Panel>

              <HSplitHandle />

              <Panel defaultSize={config.layout.topHorizontal[1]} minSize={20}>
                <PanelGroup
                  key="developer-inner"
                  direction="horizontal"
                  onLayout={(sizes) => {
                    // Developer column renders terminal (first) then explorer
                    // (second), but config.layout.developerInner keeps its
                    // semantic order [explorer, terminal] so existing workspaces
                    // don't need migration. Map by visual index here.
                    if (sizes.length === 2 && sizes[1] > 0) {
                      setLayout({ developerInner: [sizes[1], sizes[0]] })
                    }
                  }}
                >
                  <Panel
                    key="developer-terminal"
                    id="developer-terminal"
                    order={1}
                    defaultSize={
                      config.developerExplorerVisible ? config.layout.developerInner[1] : 100
                    }
                    minSize={20}
                  >
                    <TerminalPane
                      id="developer"
                      label="Developer"
                      cwd={config.developer_dir}
                      command={config.developer_tool}
                      onSelectionChange={setDeveloperSelection}
                      onSendToOther={() => sendTerminalToOther('developer')}
                      onSendToLeftEditor={() => sendTerminalToEditor('developer', 'left')}
                      onSendToRightEditor={() => sendTerminalToEditor('developer', 'right')}
                      mirrored
                      sideTool={
                        <ExplorerToggleButton
                          side="developer"
                          visible={config.developerExplorerVisible}
                          onClick={toggleDeveloperExplorer}
                        />
                      }
                    />
                  </Panel>
                  <PanelResizeHandle
                    className={`hsplit-handle${config.developerExplorerVisible ? '' : ' hsplit-handle-hidden'}`}
                    disabled={!config.developerExplorerVisible}
                  />
                  <Panel
                    key="developer-explorer"
                    id="developer-explorer"
                    order={2}
                    ref={developerExplorerRef}
                    collapsible
                    collapsedSize={0}
                    defaultSize={
                      config.developerExplorerVisible ? config.layout.developerInner[0] : 0
                    }
                    minSize={10}
                    onCollapse={() => setDeveloperExplorerVisible(false)}
                    onExpand={() => setDeveloperExplorerVisible(true)}
                  >
                    <FileTree
                      root={config.developer_dir}
                      label="Project Files"
                      onOpenFile={openFileInDeveloperPane}
                    />
                  </Panel>
                </PanelGroup>
              </Panel>
            </PanelGroup>
          </Panel>

          <VSplitHandle />

          <Panel defaultSize={config.layout.mainVertical[1]} minSize={15}>
            <BottomEditors
              panes={config.editors}
              initialSizes={config.layout.bottomHorizontal}
              onLayout={(sizes) => setLayout({ bottomHorizontal: sizes })}
              editorAppend={editorAppend}
              registerEditor={registerEditor}
              onChangeNotesPath={changeNotesPath}
              onPasteToTerminal={pasteToTerminal}
              projectRoot={projectRoot || config.developer_dir}
              hasLeftEditor={!!consultantEditor}
              promptDirtyForPane={promptDirtyBeforeAction}
              openFileInLeft={openFileInConsultantPane}
              openFileInRight={openFileInDeveloperPane}
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
  editorAppend,
  registerEditor,
  onChangeNotesPath,
  onPasteToTerminal,
  projectRoot,
  hasLeftEditor,
  promptDirtyForPane,
  openFileInLeft,
  openFileInRight
}: {
  panes: EditorPaneData[]
  initialSizes: number[]
  onLayout: (sizes: number[]) => void
  editorAppend: { seq: number; paneId: string; text: string } | null
  registerEditor: (id: string) => (h: EditorPaneHandle | null) => void
  onChangeNotesPath: (newPath: string) => void
  onPasteToTerminal: (target: 'consultant' | 'developer', text: string) => void
  projectRoot: string
  hasLeftEditor: boolean
  promptDirtyForPane: (paneId: string, action: string) => Promise<boolean>
  openFileInLeft: (path: string) => Promise<void>
  openFileInRight: (path: string) => Promise<void>
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
      {panes.map((pane, idx) => {
        const externalAppend =
          editorAppend && editorAppend.paneId === pane.id
            ? { seq: editorAppend.seq, text: editorAppend.text }
            : null
        return (
          <PaneWithHandle
            key={pane.id}
            isFirst={idx === 0}
            defaultSize={defaultSizes[idx] ?? Math.round(100 / panes.length)}
          >
            {pane.isNotes ? (
              <NotesOrFiles
                pane={pane}
                notesPath={notesPath}
                projectRoot={projectRoot}
                registerEditor={registerEditor(pane.id)}
                onRename={(name) => setEditorPane(pane.id, { name })}
                onChangeNotesPath={onChangeNotesPath}
                externalAppend={externalAppend}
                onPasteToTerminal={onPasteToTerminal}
                hasLeftEditor={hasLeftEditor}
                promptNotesDirty={() => promptDirtyForPane(pane.id, 'switch to Files mode')}
                openLeft={openFileInLeft}
                openRight={openFileInRight}
              />
            ) : (
              <EditorPane
                ref={registerEditor(pane.id)}
                pane={pane}
                onRename={(name) => setEditorPane(pane.id, { name })}
                externalAppend={externalAppend}
                onPasteToTerminal={onPasteToTerminal}
              />
            )}
          </PaneWithHandle>
        )
      })}
    </PanelGroup>
  )
}

// Center-bottom surface: the existing Notes editor or a global workspace file
// picker. Mode is local renderer state and intentionally not persisted.
// The Notes EditorPane unmounts when entering Files mode, so we gate the
// Notes → Files transition on the same dirty-editor prompt used by other
// editor replacements; otherwise switching could silently discard edits.
function NotesOrFiles({
  pane,
  notesPath,
  projectRoot,
  registerEditor,
  onRename,
  onChangeNotesPath,
  externalAppend,
  onPasteToTerminal,
  hasLeftEditor,
  promptNotesDirty,
  openLeft,
  openRight
}: {
  pane: EditorPaneData
  notesPath: string
  projectRoot: string
  registerEditor: (h: EditorPaneHandle | null) => void
  onRename: (name: string) => void
  onChangeNotesPath: (newPath: string) => void
  externalAppend: { seq: number; text: string } | null
  onPasteToTerminal: (target: 'consultant' | 'developer', text: string) => void
  hasLeftEditor: boolean
  promptNotesDirty: () => Promise<boolean>
  openLeft: (path: string) => Promise<void>
  openRight: (path: string) => Promise<void>
}): JSX.Element {
  const [mode, setMode] = useState<'notes' | 'files'>('notes')
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  async function switchTo(next: 'notes' | 'files'): Promise<void> {
    if (next === mode) return
    if (next === 'files' && !(await promptNotesDirty())) return
    setMode(next)
  }

  const toggle = (
    <div className="mode-toggle" role="tablist" aria-label="Center pane mode">
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'notes'}
        className={mode === 'notes' ? 'on' : ''}
        onClick={() => void switchTo('notes')}
        title="Show Notes editor"
      >
        Notes
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'files'}
        className={mode === 'files' ? 'on' : ''}
        onClick={() => void switchTo('files')}
        title="Show workspace files"
      >
        Files
      </button>
    </div>
  )

  if (mode === 'notes') {
    return (
      <EditorPane
        ref={registerEditor}
        pane={{ ...pane, filePath: notesPath }}
        onRename={onRename}
        onChangeNotesPath={onChangeNotesPath}
        externalAppend={externalAppend}
        onPasteToTerminal={onPasteToTerminal}
        headerExtras={toggle}
      />
    )
  }

  const openLeftTitle = !hasLeftEditor
    ? 'Show the Consultant Files explorer to enable a left editor target'
    : selectedFile
      ? `Open ${selectedFile} in the Left Editor`
      : 'Select a file to open in the Left Editor'
  const openRightTitle = selectedFile
    ? `Open ${selectedFile} in the Right Editor`
    : 'Select a file to open in the Right Editor'

  return (
    <FileTree
      root={projectRoot}
      label="Files"
      onOpenFile={setSelectedFile}
      headerExtras={
        <>
          {toggle}
          <button
            type="button"
            disabled={!selectedFile || !hasLeftEditor}
            onClick={() => {
              if (selectedFile) void openLeft(selectedFile)
            }}
            title={openLeftTitle}
          >
            Open Left
          </button>
          <button
            type="button"
            disabled={!selectedFile}
            onClick={() => {
              if (selectedFile) void openRight(selectedFile)
            }}
            title={openRightTitle}
          >
            Open Right
          </button>
        </>
      }
    />
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
  // Point the chevron toward the explorer panel: consultant explorer is on
  // the left, developer explorer is on the right.
  const chev =
    side === 'consultant' ? (visible ? '◀' : '▶') : visible ? '▶' : '◀'
  return (
    <button
      className={`explorer-toggle${visible ? ' on' : ''}`}
      onClick={onClick}
      aria-pressed={visible}
      aria-label={title}
      title={title}
    >
      <span className="explorer-toggle-chev" aria-hidden="true">{chev}</span>
      <span className="explorer-toggle-text">Files</span>
    </button>
  )
}
