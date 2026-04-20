// Single source of truth for IPC channel names. Both main and preload import
// from here so renaming a channel surfaces in both halves at once.
export const IPC = {
  app: {
    getProjectRoot: 'app:getProjectRoot'
  },
  config: {
    load: 'config:load',
    save: 'config:save'
  },
  pty: {
    open: 'pty:open',
    write: 'pty:write',
    resize: 'pty:resize',
    close: 'pty:close',
    data: 'pty:data',
    exit: 'pty:exit'
  },
  fs: {
    list: 'fs:list',
    read: 'fs:read',
    write: 'fs:write'
  },
  git: {
    sync: 'git:sync',
    output: 'git:output'
  },
  dialog: {
    pickDirectory: 'dialog:pickDirectory'
  },
  tool: {
    detect: 'tool:detect'
  }
} as const

export type PtyOpenArgs = {
  id: string
  cwd: string
  command: string
  cols: number
  rows: number
}
