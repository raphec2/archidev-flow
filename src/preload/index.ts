import { contextBridge, ipcRenderer } from 'electron'
import type { Config, DirEntry } from '../shared/config'

type PtyOpenArgs = { id: string; cwd: string; command: string; cols: number; rows: number }
type PtyExitInfo = { exitCode: number; signal?: number }
type GitSyncResult = {
  ok: boolean
  code: number
  step: 'add' | 'commit' | 'push' | 'done'
  output: string
}

const api = {
  app: {
    getProjectRoot: (): Promise<string> => ipcRenderer.invoke('app:getProjectRoot')
  },
  config: {
    load: (): Promise<Config> => ipcRenderer.invoke('config:load'),
    save: (cfg: Config): Promise<boolean> => ipcRenderer.invoke('config:save', cfg)
  },
  pty: {
    open: (args: PtyOpenArgs): Promise<boolean> => ipcRenderer.invoke('pty:open', args),
    write: (id: string, data: string): Promise<boolean> =>
      ipcRenderer.invoke('pty:write', id, data),
    resize: (id: string, cols: number, rows: number): Promise<boolean> =>
      ipcRenderer.invoke('pty:resize', id, cols, rows),
    close: (id: string): Promise<boolean> => ipcRenderer.invoke('pty:close', id),
    onData: (listener: (id: string, data: string) => void): (() => void) => {
      const wrapped = (_e: unknown, id: string, data: string): void => listener(id, data)
      ipcRenderer.on('pty:data', wrapped)
      return () => ipcRenderer.removeListener('pty:data', wrapped)
    },
    onExit: (listener: (id: string, info: PtyExitInfo) => void): (() => void) => {
      const wrapped = (_e: unknown, id: string, info: PtyExitInfo): void => listener(id, info)
      ipcRenderer.on('pty:exit', wrapped)
      return () => ipcRenderer.removeListener('pty:exit', wrapped)
    }
  },
  fs: {
    list: (dir: string): Promise<DirEntry[]> => ipcRenderer.invoke('fs:list', dir),
    read: (path: string): Promise<string> => ipcRenderer.invoke('fs:read', path),
    write: (path: string, content: string): Promise<void> =>
      ipcRenderer.invoke('fs:write', path, content)
  },
  git: {
    sync: (cwd: string, message: string): Promise<GitSyncResult> =>
      ipcRenderer.invoke('git:sync', cwd, message),
    onOutput: (listener: (chunk: string) => void): (() => void) => {
      const wrapped = (_e: unknown, chunk: string): void => listener(chunk)
      ipcRenderer.on('git:output', wrapped)
      return () => ipcRenderer.removeListener('git:output', wrapped)
    }
  },
  dialog: {
    pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickDirectory')
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
