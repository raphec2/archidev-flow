import * as nodePty from 'node-pty'
import { BrowserWindow } from 'electron'

type Session = {
  id: string
  pty: nodePty.IPty
}

const sessions = new Map<string, Session>()

function isWin(): boolean {
  return process.platform === 'win32'
}

function buildShellInvocation(command: string): { shell: string; args: string[] } {
  if (isWin()) {
    // Run command in PowerShell, keep a fresh PowerShell alive after it exits.
    const inner = `try { ${command} } catch { $_ | Out-String | Write-Host }; Write-Host ''; Write-Host '[tool exited — shell is still open]'`
    return { shell: 'powershell.exe', args: ['-NoLogo', '-NoExit', '-Command', inner] }
  }
  const userShell = process.env.SHELL || '/bin/bash'
  // Run configured command, then hand off to an interactive shell so the pane
  // stays usable if the AI CLI exits.
  return {
    shell: userShell,
    args: ['-l', '-c', `${command}; echo ''; echo '[tool exited — shell is still open]'; exec ${userShell} -l`]
  }
}

export function openPty(opts: {
  id: string
  cwd: string
  command: string
  cols: number
  rows: number
  window: BrowserWindow
}): void {
  // If a session already exists for this id, kill it first (e.g., on config change).
  closePty(opts.id)

  const { shell, args } = buildShellInvocation(opts.command)

  const ptyProc = nodePty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: Math.max(2, opts.cols | 0),
    rows: Math.max(2, opts.rows | 0),
    cwd: opts.cwd,
    env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>
  })

  sessions.set(opts.id, { id: opts.id, pty: ptyProc })

  ptyProc.onData((data) => {
    if (!opts.window.isDestroyed()) {
      opts.window.webContents.send('pty:data', opts.id, data)
    }
  })

  ptyProc.onExit(({ exitCode, signal }) => {
    if (!opts.window.isDestroyed()) {
      opts.window.webContents.send('pty:exit', opts.id, { exitCode, signal })
    }
    sessions.delete(opts.id)
  })
}

export function writePty(id: string, data: string): void {
  sessions.get(id)?.pty.write(data)
}

export function resizePty(id: string, cols: number, rows: number): void {
  const s = sessions.get(id)
  if (!s) return
  try {
    s.pty.resize(Math.max(2, cols | 0), Math.max(2, rows | 0))
  } catch {
    // PTY may have exited; ignore resize errors.
  }
}

export function closePty(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  try { s.pty.kill() } catch { /* ignore */ }
  sessions.delete(id)
}

export function closeAllPtys(): void {
  for (const id of Array.from(sessions.keys())) closePty(id)
}
