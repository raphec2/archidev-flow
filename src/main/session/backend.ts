import type { PtyExitInfo } from '../../shared/config'

// SessionBackend is the only contract the renderer sees. A future SSH-backed
// implementation plugs in here without touching UI code. Only a local PTY
// implementation exists today and nothing else is planned.
export type OpenSessionArgs = {
  id: string
  cwd: string
  command: string
  cols: number
  rows: number
}

export type SessionEvents = {
  onData: (id: string, data: string) => void
  onExit: (id: string, info: PtyExitInfo) => void
}

export interface SessionBackend {
  open(args: OpenSessionArgs): void
  write(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  close(id: string): void
  closeAll(): void
}
