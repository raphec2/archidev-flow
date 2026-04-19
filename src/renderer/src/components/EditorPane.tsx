import { useEffect, useRef, useState } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { basicSetup } from 'codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import type { EditorPane as EditorPaneData } from '../../../shared/config'

type Props = {
  pane: EditorPaneData
  onRename: (name: string) => void
  onContentChange?: (content: string) => void
  // Controlled content used for programmatic appends (e.g. terminal → notes).
  externalAppend?: { seq: number; text: string } | null
}

export function EditorPane({
  pane,
  onRename,
  onContentChange,
  externalAppend
}: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const dirtyRef = useRef<boolean>(false)
  const savingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const readOnlyComp = useRef(new Compartment())
  const [loadedPath, setLoadedPath] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('')

  // Create the editor once per mount.
  useEffect(() => {
    if (!hostRef.current) return
    const state = EditorState.create({
      doc: '',
      extensions: [
        basicSetup,
        keymap.of([...defaultKeymap, indentWithTab]),
        oneDark,
        readOnlyComp.current.of(EditorState.readOnly.of(false)),
        EditorView.updateListener.of((v) => {
          if (v.docChanged) {
            dirtyRef.current = true
            const content = v.state.doc.toString()
            onContentChange?.(content)
            scheduleSave(content)
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

  // Load file contents when pane file path changes.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const target = pane.isNotes ? pane.filePath : pane.filePath
    if (!target) {
      // Nothing to load.
      if (!pane.isNotes && loadedPath !== null) {
        // Clear previous file if this pane switched back to empty.
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '' } })
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
        dirtyRef.current = false
        setLoadedPath(target)
        setStatus('')
      })
      .catch((err: unknown) => {
        setStatus(err instanceof Error ? err.message : String(err))
      })
  }, [pane.filePath, pane.isNotes, loadedPath])

  // Handle external appends (selection → notes).
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
    dirtyRef.current = true
    scheduleSave(view.state.doc.toString() + '' )
  }, [externalAppend])

  function scheduleSave(content: string): void {
    if (!pane.filePath) return
    if (savingTimer.current) clearTimeout(savingTimer.current)
    savingTimer.current = setTimeout(() => {
      const target = pane.filePath
      if (!target) return
      setStatus('saving…')
      window.api.fs
        .write(target, content)
        .then(() => {
          dirtyRef.current = false
          setStatus('')
        })
        .catch((err: unknown) => {
          setStatus(err instanceof Error ? err.message : String(err))
        })
    }, 400)
  }

  const displayPath = pane.filePath || (pane.isNotes ? '(notes)' : '(no file)')

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
          <span className="path" title={displayPath}>{displayPath}</span>
        </div>
        <div className="toolbar">
          {status && <span style={{ color: 'var(--text-2)', fontSize: 11 }}>{status}</span>}
        </div>
      </div>
      <div className="pane-body">
        <div ref={hostRef} className="editor-host" />
      </div>
    </div>
  )
}
