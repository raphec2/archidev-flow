import { useEffect, useMemo, useRef, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useStore } from './store'
import { TerminalPane } from './components/TerminalPane'
import { FileTree } from './components/FileTree'
import { EditorPane } from './components/EditorPane'
import { GitSyncDialog } from './components/GitSyncDialog'

function HSplitHandle(): JSX.Element {
  return <PanelResizeHandle className="hsplit-handle" />
}
function VSplitHandle(): JSX.Element {
  return <PanelResizeHandle className="vsplit-handle" />
}

export default function App(): JSX.Element {
  const config = useStore((s) => s.config)
  const setConfig = useStore((s) => s.setConfig)
  const setProjectRoot = useStore((s) => s.setProjectRoot)
  const projectRoot = useStore((s) => s.projectRoot)
  const setLayout = useStore((s) => s.setLayout)
  const setConsultantExplorerVisible = useStore((s) => s.setConsultantExplorerVisible)
  const setEditorPane = useStore((s) => s.setEditorPane)
  const consultantSelection = useStore((s) => s.consultantSelection)
  const developerSelection = useStore((s) => s.developerSelection)
  const setConsultantSelection = useStore((s) => s.setConsultantSelection)
  const setDeveloperSelection = useStore((s) => s.setDeveloperSelection)

  const [showGitDialog, setShowGitDialog] = useState(false)
  const [notesAppend, setNotesAppend] = useState<{ seq: number; text: string } | null>(null)

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
  const notesEditor = config.editors.find((e) => e.id === 'notes')
  const consultantEditor = config.editors.find((e) => e.id === 'consultantFile')

  function openFileInDeveloperPane(path: string): void {
    if (!developerEditor) return
    setEditorPane('file', { filePath: path })
  }
  function openFileInConsultantPane(path: string): void {
    const target = consultantEditor ? 'consultantFile' : 'file'
    setEditorPane(target, { filePath: path })
  }

  return (
    <div className="app">
      <div className="app-header">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div className="title">ArchiDev-Flow</div>
          <div className="sub">{projectRoot}</div>
        </div>
        <div className="actions">
          <button
            onClick={() => setConsultantExplorerVisible(!config.consultantExplorerVisible)}
            title="Toggle consultant-side file explorer"
          >
            {config.consultantExplorerVisible ? '✓ ' : ''}Consultant Explorer
          </button>
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
              {/* Left: consultant workspace */}
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
                  />
                )}
              </Panel>

              <HSplitHandle />

              {/* Right: developer workspace */}
              <Panel defaultSize={config.layout.topHorizontal[1]} minSize={20}>
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
              notesAppend={notesAppend}
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
  notesAppend
}: {
  panes: import('../../shared/config').EditorPane[]
  initialSizes: number[]
  onLayout: (sizes: number[]) => void
  notesAppend: { seq: number; text: string } | null
}): JSX.Element {
  const setEditorPane = useStore((s) => s.setEditorPane)
  const config = useStore((s) => s.config)!

  // Ensure there's always a notesPath to save notes into.
  const notesPath = config.notesPath

  // Normalize sizes to panes length.
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
            pane={{
              ...pane,
              filePath: pane.isNotes ? notesPath : pane.filePath
            }}
            onRename={(name) => setEditorPane(pane.id, { name })}
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
