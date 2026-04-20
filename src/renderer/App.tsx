import { useEffect, useMemo, useRef, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useStore } from './store'
import { TerminalPane } from './components/TerminalPane'
import { FileTree } from './components/FileTree'
import { EditorPane, type EditorPaneHandle } from './components/EditorPane'
import { GitSyncDialog } from './components/GitSyncDialog'
import { OnboardingDialog } from './components/OnboardingDialog'
import type { EditorPane as EditorPaneData } from '../shared/config'

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

  const [showGitDialog, setShowGitDialog] = useState(false)
  const [notesAppend, setNotesAppend] = useState<{ seq: number; text: string } | null>(null)

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
          <button onClick={() => setShowGitDialog(true)} title="git add + commit + push">
            Sync &amp; Push
          </button>
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
                        trailingTool={
                          <ExplorerToggleButton
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
                    trailingTool={
                      <ExplorerToggleButton
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
                        trailingTool={
                          <ExplorerToggleButton
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
                    trailingTool={
                      <ExplorerToggleButton
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

      {showGitDialog && (
        <GitSyncDialog cwd={config.developer_dir} onClose={() => setShowGitDialog(false)} />
      )}
    </div>
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
  visible,
  onClick
}: {
  visible: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={visible ? 'Hide file explorer for this side' : 'Show file explorer for this side'}
    >
      {visible ? '× files' : '☰ files'}
    </button>
  )
}
