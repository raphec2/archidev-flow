import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { basicSetup } from 'codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import type { EditorPane as EditorPaneData } from '../../shared/config'

export type EditorPaneHandle = {
  isDirty: () => boolean
  save: () => Promise<{ ok: boolean; error?: string }>
  saveAs: (path: string) => Promise<{ ok: boolean; error?: string }>
  path: () => string | null
  displayName: () => string
}

type Props = {
  pane: EditorPaneData
  onRename: (name: string) => void
  onChangeNotesPath?: (newPath: string) => void
  externalAppend?: { seq: number; text: string } | null
  onPasteToTerminal?: (target: 'consultant' | 'developer', text: string) => void
  // Caller-supplied controls that render in the same toolbar, so wrappers
  // (e.g. the bottom-center Notes/Files toggle) can extend the header
  // without nesting a second pane chrome.
  headerExtras?: ReactNode
}

export const EditorPane = forwardRef<EditorPaneHandle, Props>(function EditorPane(
  { pane, onRename, onChangeNotesPath, externalAppend, onPasteToTerminal, headerExtras },
  ref
): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const readOnlyComp = useRef(new Compartment())
  const [loadedPath, setLoadedPath] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('')
  const [dirty, setDirty] = useState<boolean>(false)
  const [hasSelection, setHasSelection] = useState<boolean>(false)
  const dirtyRef = useRef<boolean>(false)
  const paneRef = useRef(pane)
  paneRef.current = pane

  function markDirty(v: boolean): void {
    dirtyRef.current = v
    setDirty(v)
  }

  async function writeTo(target: string): Promise<{ ok: boolean; error?: string }> {
    const view = viewRef.current
    if (!view) return { ok: false, error: 'editor not ready' }
    const content = view.state.doc.toString()
    setStatus('saving…')
    try {
      await window.api.fs.write(target, content)
      if (viewRef.current && viewRef.current.state.doc.toString() === content) {
        markDirty(false)
      }
      setStatus('saved')
      setTimeout(() => setStatus((s) => (s === 'saved' ? '' : s)), 1200)
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setStatus(msg)
      return { ok: false, error: msg }
    }
  }

  async function doSave(): Promise<{ ok: boolean; error?: string }> {
    const target = paneRef.current.filePath
    if (!target) return { ok: false, error: 'no file to save' }
    return writeTo(target)
  }

  function getSelectionText(): string {
    const view = viewRef.current
    if (!view) return ''
    const { from, to } = view.state.selection.main
    if (from === to) return ''
    return view.state.sliceDoc(from, to)
  }

  function handlePasteToTerminal(target: 'consultant' | 'developer'): void {
    if (!onPasteToTerminal) return
    const text = getSelectionText()
    if (!text) return
    onPasteToTerminal(target, text)
  }

  useImperativeHandle(ref, () => ({
    isDirty: () => dirtyRef.current,
    save: doSave,
    saveAs: (path: string) => writeTo(path),
    path: () => paneRef.current.filePath,
    displayName: () => paneRef.current.name
  }))

  async function handleChangeNotesPath(): Promise<void> {
    if (!onChangeNotesPath) return
    const current = paneRef.current.filePath || undefined
    const picked = await window.api.dialog.pickSavePath({
      title: 'Choose notes save location',
      defaultPath: current
    })
    if (!picked) return
    // Write current buffer to the chosen path so switching persists content.
    // The parent then updates config.notesPath, the file-load effect reloads
    // from the new path (same content we just wrote), and dirty clears.
    const r = await writeTo(picked)
    if (!r.ok) return
    onChangeNotesPath(picked)
  }

  useEffect(() => {
    if (!hostRef.current) return
    const state = EditorState.create({
      doc: '',
      extensions: [
        basicSetup,
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              void doSave()
              return true
            }
          },
          ...defaultKeymap,
          indentWithTab
        ]),
        oneDark,
        readOnlyComp.current.of(EditorState.readOnly.of(false)),
        EditorView.updateListener.of((v) => {
          if (v.docChanged) markDirty(true)
          if (v.selectionSet || v.docChanged) {
            setHasSelection(!v.state.selection.main.empty)
          }
        })
      ]
    })
    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const target = pane.filePath
    if (!target) {
      if (!pane.isNotes && loadedPath !== null) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '' } })
        markDirty(false)
        setLoadedPath(null)
      }
      return
    }
    if (target === loadedPath) return
    setStatus('loading…')
    window.api.fs
      .read(target)
      .then((content) => {
        const current = view.state.doc.toString()
        if (current !== content) {
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } })
        }
        markDirty(false)
        setLoadedPath(target)
        setStatus('')
      })
      .catch((err: unknown) => {
        setStatus(err instanceof Error ? err.message : String(err))
      })
  }, [pane.filePath, pane.isNotes, loadedPath])

  useEffect(() => {
    const view = viewRef.current
    if (!view || !externalAppend) return
    const text = externalAppend.text
    if (!text) return
    const insert = (view.state.doc.length > 0 ? '\n' : '') + text + '\n'
    view.dispatch({
      changes: { from: view.state.doc.length, insert },
      selection: { anchor: view.state.doc.length + insert.length },
      scrollIntoView: true
    })
    markDirty(true)
  }, [externalAppend])

  const displayPath = pane.filePath || (pane.isNotes ? '(notes)' : '(no file)')
  const canSave = dirty && !!pane.filePath

  return (
    <div className="pane">
      <div className="pane-header">
        <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
          <input
            className="pane-name-input"
            value={pane.name}
            onChange={(e) => onRename(e.target.value)}
            spellCheck={false}
            aria-label="Pane name"
          />
          <span className="path" title={displayPath}>
            {dirty && (
              <span className="dirty-dot" aria-label="unsaved changes" title="Unsaved changes">
                ●
              </span>
            )}
            {displayPath}
          </span>
        </div>
        <div className="toolbar">
          {headerExtras}
          {status && <span style={{ color: 'var(--text-2)', fontSize: 11 }}>{status}</span>}
          {onPasteToTerminal && (
            <>
              <button
                onClick={() => handlePasteToTerminal('consultant')}
                disabled={!hasSelection}
                title={
                  hasSelection
                    ? 'Paste selection into Consultant (left) terminal'
                    : 'Select text to paste into Consultant (left) terminal'
                }
              >
                → Left
              </button>
              <button
                onClick={() => handlePasteToTerminal('developer')}
                disabled={!hasSelection}
                title={
                  hasSelection
                    ? 'Paste selection into Developer (right) terminal'
                    : 'Select text to paste into Developer (right) terminal'
                }
              >
                → Right
              </button>
            </>
          )}
          {pane.isNotes && onChangeNotesPath && (
            <button
              onClick={() => void handleChangeNotesPath()}
              title="Choose a different file/location for saving notes"
            >
              Notes path…
            </button>
          )}
          <button
            onClick={() => void doSave()}
            disabled={!canSave}
            title={pane.filePath ? 'Save (Ctrl/Cmd+S)' : 'No file to save'}
          >
            Save
          </button>
        </div>
      </div>
      <div className="pane-body">
        <div ref={hostRef} className="editor-host" />
      </div>
    </div>
  )
})
