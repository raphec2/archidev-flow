import * as nodePty from 'node-pty'
import type { SessionBackend, SessionEvents, OpenSessionArgs } from './backend'

type Session = {
  id: string
  pty: nodePty.IPty
}

function isWin(): boolean {
  return process.platform === 'win32'
}

function buildShellInvocation(command: string): { shell: string; args: string[] } {
  if (isWin()) {
    const inner = `try { ${command} } catch { $_ | Out-String | Write-Host }; Write-Host ''; Write-Host '[tool exited — shell is still open]'`
    return { shell: 'powershell.exe', args: ['-NoLogo', '-NoExit', '-Command', inner] }
  }
  const userShell = process.env.SHELL || '/bin/bash'
  return {
    shell: userShell,
    args: [
      '-l',
      '-c',
      `${command}; echo ''; echo '[tool exited — shell is still open]'; exec ${userShell} -l`
    ]
  }
}

export class LocalPtyBackend implements SessionBackend {
  private sessions = new Map<string, Session>()

  constructor(private events: SessionEvents) {}

  open(opts: OpenSessionArgs): void {
    // If a session already exists for this id (e.g. config change or restart),
    // replace it.
    this.close(opts.id)

    const { shell, args } = buildShellInvocation(opts.command)

    const pty = nodePty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: Math.max(2, opts.cols | 0),
      rows: Math.max(2, opts.rows | 0),
      cwd: opts.cwd,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>
    })

    this.sessions.set(opts.id, { id: opts.id, pty })

    pty.onData((data) => {
      // If we've been replaced (StrictMode double-mount, or a restart), drop
      // output from the stale PTY so it doesn't bleed into the live terminal.
      if (this.sessions.get(opts.id)?.pty !== pty) return
      this.events.onData(opts.id, data)
    })

    pty.onExit(({ exitCode, signal }) => {
      // Only forward exit (and clear the slot) if we're still the registered
      // session. StrictMode's setup → cleanup → setup sequence would otherwise
      // have PTY A's async onExit evict PTY B from the map after B took over.
      const current = this.sessions.get(opts.id)
      if (current?.pty !== pty) return
      this.events.onExit(opts.id, { exitCode, signal })
      this.sessions.delete(opts.id)
    })
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id)
    if (!s) return
    try {
      s.pty.resize(Math.max(2, cols | 0), Math.max(2, rows | 0))
    } catch {
      // PTY may have exited; ignore resize errors.
    }
  }

  close(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    try {
      s.pty.kill()
    } catch {
      /* ignore */
    }
    this.sessions.delete(id)
  }

  closeAll(): void {
    for (const id of Array.from(this.sessions.keys())) this.close(id)
  }
}
