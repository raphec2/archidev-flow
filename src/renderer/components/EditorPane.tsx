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
  // Save-As callback: caller passes this when the pane supports relocating
  // the underlying document via a save dialog (currently only Notes). When
  // present, an explicit "Save As…" button appears, and an ordinary Save with
  // no current filePath routes through Save As instead of failing silently.
  onChangeNotesPath?: (newPath: string) => void
  externalAppend?: { seq: number; text: string } | null
  onPasteToTerminal?: (target: 'consultant' | 'developer', text: string) => void
  // Caller-supplied controls that render in the same toolbar, so wrappers
  // (e.g. the bottom-center Notes/Files toggle) can extend the header
  // without nesting a second pane chrome.
  headerExtras?: ReactNode
  // Close-document control. Owners (App.tsx for left/right, Notes wrapper for
  // center) handle the dirty prompt themselves; this just signals intent.
  onClose?: () => void
  // New-document control (Notes only). Same contract as onClose.
  onNew?: () => void
}

export const EditorPane = forwardRef<EditorPaneHandle, Props>(function EditorPane(
  {
    pane,
    onRename,
    onChangeNotesPath,
    externalAppend,
    onPasteToTerminal,
    headerExtras,
    onClose,
    onNew
  },
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
  // Last externalAppend.seq actually applied. Parent re-renders (git poll,
  // focus, layout, config saves) recreate the externalAppend object literal
  // even when no new paste happened; without this guard the append effect
  // would replay the same text on every re-render.
  const lastAppliedAppendSeqRef = useRef<number | null>(null)

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
    if (target) return writeTo(target)
    // Untitled buffer: route to Save As if the caller supports it. This is
    // also what the dirty-quit / dirty-replace prompt's "Save" branch ends up
    // calling, so picking Save on an untitled Notes buffer opens the picker
    // instead of failing the prompt.
    if (onChangeNotesPath) return doSaveAs()
    return { ok: false, error: 'no file to save' }
  }

  async function doSaveAs(): Promise<{ ok: boolean; error?: string }> {
    if (!onChangeNotesPath) return { ok: false, error: 'save-as not available' }
    const current = paneRef.current.filePath || undefined
    const picked = await window.api.dialog.pickSavePath({
      title: 'Save notes as…',
      defaultPath: current
    })
    if (!picked) return { ok: false, error: 'cancelled' }
    const r = await writeTo(picked)
    if (!r.ok) return r
    // Notify the wrapper after a successful write so its document-path state
    // and config.notesPath both update; the file-load effect then re-reads
    // `picked` and finds matching content (no-op dispatch).
    onChangeNotesPath(picked)
    return { ok: true }
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
      // Going from a loaded path to no path means the document was closed
      // (or Notes hit New). Clear the buffer so the editor reflects the
      // untitled state instead of stranding the previous file's contents.
      // Owners run the dirty prompt before getting here, so it's safe to drop
      // the buffer unconditionally.
      if (loadedPath !== null) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '' } })
        markDirty(false)
        setLoadedPath(null)
        setStatus('')
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
  }, [pane.filePath, loadedPath])

  // Append from terminal selection. Depend on the scalar seq (not the parent's
  // object literal) and skip when the seq has already been applied, so unrelated
  // re-renders cannot replay the previous paste.
  const appendSeq = externalAppend?.seq ?? null
  const appendText = externalAppend?.text ?? ''
  useEffect(() => {
    const view = viewRef.current
    if (!view || appendSeq === null || !appendText) return
    if (lastAppliedAppendSeqRef.current === appendSeq) return
    lastAppliedAppendSeqRef.current = appendSeq
    const insert = (view.state.doc.length > 0 ? '\n' : '') + appendText + '\n'
    view.dispatch({
      changes: { from: view.state.doc.length, insert },
      selection: { anchor: view.state.doc.length + insert.length },
      scrollIntoView: true
    })
    markDirty(true)
  }, [appendSeq, appendText])

  const displayPath =
    pane.filePath || (pane.isNotes ? '(untitled notes)' : '(no file)')
  // For Notes, Save remains enabled when dirty even without a path because
  // it routes through Save As. Plain editors stay disabled until a path is set.
  const canSave = dirty && (!!pane.filePath || !!onChangeNotesPath)
  const saveTitle = pane.filePath
    ? 'Save (Ctrl/Cmd+S)'
    : onChangeNotesPath
      ? 'Save As… (Ctrl/Cmd+S)'
      : 'No file to save'

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
          {onNew && (
            <button
              onClick={() => void onNew()}
              title="Start a new notes document"
            >
              New
            </button>
          )}
          {onChangeNotesPath && (
            <button
              onClick={() => void doSaveAs()}
              title="Save the current notes buffer to a chosen file"
            >
              Save As…
            </button>
          )}
          <button
            onClick={() => void doSave()}
            disabled={!canSave}
            title={saveTitle}
          >
            Save
          </button>
          {onClose && (
            <button
              onClick={() => onClose()}
              title="Close the document (prompts if there are unsaved changes)"
            >
              Close
            </button>
          )}
        </div>
      </div>
      <div className="pane-body">
        <div ref={hostRef} className="editor-host" />
      </div>
    </div>
  )
})
