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
  onSendToLeftEditor: () => void
  onSendToRightEditor: () => void
  sideTool?: React.ReactNode
  mirrored?: boolean
}

export function TerminalPane({
  id,
  label,
  cwd,
  command,
  onSelectionChange,
  onSendToOther,
  onSendToLeftEditor,
  onSendToRightEditor,
  sideTool,
  mirrored = false
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

    requestAnimationFrame(() => {
      try { fit.fit() } catch { /* ignore */ }
      window.api.pty.open({ id, cwd, command, cols: term.cols, rows: term.rows })
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
    // cwd/command are only used on initial open; changing them requires
    // recreating the pane, so exhaustive-deps is intentionally relaxed here.
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
    // open() closes any existing session for this id first, so no separate
    // close call is needed.
    window.api.pty.open({ id, cwd, command, cols: term.cols, rows: term.rows })
    term.focus()
  }

  function pasteIntoTerminal(text: string): void {
    if (!text) return
    // Use xterm's paste pipeline, not a raw pty.write: it honors bracketed-paste
    // (DECSET 2004) when the foreground program supports it, so embedded
    // newlines arrive as literal input instead of being read as Enter and
    // firing each line as its own command. Emits one onData → one pty.write.
    termRef.current?.paste(text)
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const handler = (e: Event): void => {
      const ce = e as CustomEvent<string>
      pasteIntoTerminal(ce.detail)
      // Hand keyboard focus to this terminal so the next Enter/keystroke
      // acts where the pasted text landed. Shared by terminal-to-terminal
      // transfer and editor paste-to-left/right actions.
      termRef.current?.focus()
    }
    host.addEventListener('archidev:paste', handler as EventListener)
    return () => host.removeEventListener('archidev:paste', handler as EventListener)
  }, [])

  const leftButton = (
    <button
      className="btn-side-left"
      onClick={onSendToLeftEditor}
      title="Paste selection into Left Editor"
    >
      Left
    </button>
  )
  const rightButton = (
    <button
      className="btn-side-right"
      onClick={onSendToRightEditor}
      title="Paste selection into Right Editor"
    >
      Right
    </button>
  )
  const terminalButton = (
    <button onClick={onSendToOther} title="Paste selection into the other terminal (no Enter)">
      Terminal
    </button>
  )
  const restartButton = (
    <button
      className="btn-warn"
      onClick={restart}
      title="Kill the current process and rerun the configured tool"
    >
      ↻ Restart
    </button>
  )
  const pasteLabel = (
    <span className="toolbar-label" aria-hidden="true">
      Paste to
    </span>
  )

  // Pane-header layout (CSS grid, 4 cols × 2 rows):
  //   - Files (sideTool): outer edge, spans both rows, vertically centered
  //   - Restart: top row only, one column inward from Files, with extra
  //     horizontal margin so it's not flush with Files and not adjacent to
  //     any paste target
  //   - Info (label + path): stretchy middle column, spans both rows
  //   - Paste group: bottom row only, inner edge (nearest destination
  //     terminal), holds "Paste to" label + Left / Right / Terminal buttons
  // Restart ends up diagonally offset from both Files (adjacent column but
  // different row position) and the paste cluster (distant column AND
  // different row), which is the accidental-click-safe zone the user asked
  // for. Mirrored side swaps the column order so the outer edge is on the
  // right for developer; Restart still sits one column inward from Files.
  const pasteToolbar = (
    <>
      {pasteLabel}
      {mirrored ? (
        <>
          {terminalButton}
          {leftButton}
          {rightButton}
        </>
      ) : (
        <>
          {leftButton}
          {rightButton}
          {terminalButton}
        </>
      )}
    </>
  )

  return (
    <div className={`pane${mirrored ? ' pane-mirrored' : ''}`} data-terminal-id={id}>
      <div
        className={`pane-header pane-header-grid${mirrored ? ' pane-header-mirrored' : ''}`}
      >
        {mirrored ? (
          <>
            <div className="pane-header-paste toolbar">{pasteToolbar}</div>
            <div className="pane-header-info pane-header-info-mirrored">
              <span className="path" title={`${cwd} — ${command}`}>
                {cwd} · {command}
              </span>
              <span className="label">{label}</span>
            </div>
            <div className="pane-header-restart">{restartButton}</div>
            <div className="pane-header-files">{sideTool}</div>
          </>
        ) : (
          <>
            <div className="pane-header-files">{sideTool}</div>
            <div className="pane-header-restart">{restartButton}</div>
            <div className="pane-header-info">
              <span className="label">{label}</span>
              <span className="path" title={`${cwd} — ${command}`}>
                {cwd} · {command}
              </span>
            </div>
            <div className="pane-header-paste toolbar">{pasteToolbar}</div>
          </>
        )}
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
