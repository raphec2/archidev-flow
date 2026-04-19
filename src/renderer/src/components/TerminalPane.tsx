import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

type Props = {
  id: string
  label: string
  cwd: string
  command: string
  onSelectionChange: (text: string) => void
  onSendToOther: () => void
  onSendToNotes: () => void
  trailingTool?: React.ReactNode
}

export function TerminalPane({
  id,
  label,
  cwd,
  command,
  onSelectionChange,
  onSendToOther,
  onSendToNotes,
  trailingTool
}: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [exitInfo, setExitInfo] = useState<{ code: number; signal?: number } | null>(null)

  useEffect(() => {
    if (!hostRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 12,
      theme: {
        background: '#000000',
        foreground: '#e7edf3',
        cursor: '#e7edf3',
        selectionBackground: '#2a3a5a'
      },
      allowProposedApi: true,
      scrollback: 5000
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)

    // Initial fit after layout settles.
    requestAnimationFrame(() => {
      try { fit.fit() } catch { /* ignore */ }
      window.api.pty.open({
        id,
        cwd,
        command,
        cols: term.cols,
        rows: term.rows
      })
    })

    termRef.current = term
    fitRef.current = fit

    const offData = window.api.pty.onData((sid, data) => {
      if (sid === id) term.write(data)
    })
    const offExit = window.api.pty.onExit((sid, info) => {
      if (sid === id) setExitInfo({ code: info.exitCode, signal: info.signal })
    })

    const writeDisposable = term.onData((data) => {
      window.api.pty.write(id, data)
    })
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      window.api.pty.resize(id, cols, rows)
    })
    const selDisposable = term.onSelectionChange(() => {
      onSelectionChange(term.getSelection())
    })

    const ro = new ResizeObserver(() => {
      try { fit.fit() } catch { /* ignore */ }
    })
    ro.observe(hostRef.current)

    return () => {
      ro.disconnect()
      offData()
      offExit()
      writeDisposable.dispose()
      resizeDisposable.dispose()
      selDisposable.dispose()
      term.dispose()
      window.api.pty.close(id)
    }
    // Only mount/unmount per id; cwd/command are only used on initial open.
    // Changing them requires recreating the pane.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  function focus(): void {
    termRef.current?.focus()
  }

  function restart(): void {
    const term = termRef.current
    if (!term) return
    setExitInfo(null)
    term.reset()
    // openPty closes any existing session for this id first, so we don't
    // need a separate close call.
    window.api.pty.open({
      id,
      cwd,
      command,
      cols: term.cols,
      rows: term.rows
    })
    term.focus()
  }

  function pasteIntoTerminal(text: string): void {
    if (!text) return
    window.api.pty.write(id, text)
  }

  // Expose paste to parent via custom event on DOM node.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const handler = (e: Event): void => {
      const ce = e as CustomEvent<string>
      pasteIntoTerminal(ce.detail)
    }
    host.addEventListener('archidev:paste', handler as EventListener)
    return () => host.removeEventListener('archidev:paste', handler as EventListener)
  }, [])

  return (
    <div className="pane" data-terminal-id={id}>
      <div className="pane-header">
        <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
          <span className="label">{label}</span>
          <span className="path" title={`${cwd} — ${command}`}>
            {cwd} · {command}
          </span>
        </div>
        <div className="toolbar">
          <button onClick={onSendToOther} title="Paste selection into other terminal (no Enter)">→ terminal</button>
          <button onClick={onSendToNotes} title="Append selection to Notes">→ notes</button>
          <button onClick={restart} title="Kill the current process and rerun the configured tool">↻ restart</button>
          {trailingTool}
        </div>
      </div>
      <div className="pane-body" onClick={focus}>
        <div ref={hostRef} className="xterm-host" />
        {exitInfo && (
          <div className="exit-banner">
            Process exited (code {exitInfo.code}
            {exitInfo.signal ? `, signal ${exitInfo.signal}` : ''}) — shell remains open for reuse.
          </div>
        )}
      </div>
    </div>
  )
}
