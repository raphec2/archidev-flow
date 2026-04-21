import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type PtyOpenArgs,
  type ConfirmUnsavedArgs,
  type PickSavePathArgs,
  type UnsavedChoice
} from '../shared/ipc'
import type {
  Config,
  DirEntry,
  DetectedTools,
  PtyExitInfo,
  GitStatus,
  GitCommitResult,
  GitPushResult
} from '../shared/config'

const api = {
  app: {
    getProjectRoot: (): Promise<string> => ipcRenderer.invoke(IPC.app.getProjectRoot)
  },
  config: {
    load: (): Promise<Config> => ipcRenderer.invoke(IPC.config.load),
    save: (cfg: Config): Promise<boolean> => ipcRenderer.invoke(IPC.config.save, cfg)
  },
  pty: {
    open: (args: PtyOpenArgs): Promise<boolean> => ipcRenderer.invoke(IPC.pty.open, args),
    write: (id: string, data: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.pty.write, id, data),
    resize: (id: string, cols: number, rows: number): Promise<boolean> =>
      ipcRenderer.invoke(IPC.pty.resize, id, cols, rows),
    close: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.pty.close, id),
    onData: (listener: (id: string, data: string) => void): (() => void) => {
      const wrapped = (_e: unknown, id: string, data: string): void => listener(id, data)
      ipcRenderer.on(IPC.pty.data, wrapped)
      return () => ipcRenderer.removeListener(IPC.pty.data, wrapped)
    },
    onExit: (listener: (id: string, info: PtyExitInfo) => void): (() => void) => {
      const wrapped = (_e: unknown, id: string, info: PtyExitInfo): void =>
        listener(id, info)
      ipcRenderer.on(IPC.pty.exit, wrapped)
      return () => ipcRenderer.removeListener(IPC.pty.exit, wrapped)
    }
  },
  fs: {
    list: (dir: string): Promise<DirEntry[]> => ipcRenderer.invoke(IPC.fs.list, dir),
    read: (path: string): Promise<string> => ipcRenderer.invoke(IPC.fs.read, path),
    write: (path: string, content: string): Promise<void> =>
      ipcRenderer.invoke(IPC.fs.write, path, content)
  },
  git: {
    status: (cwd: string): Promise<GitStatus> =>
      ipcRenderer.invoke(IPC.git.status, cwd),
    commit: (
      cwd: string,
      message: string,
      untrackedPaths: string[] = []
    ): Promise<GitCommitResult> =>
      ipcRenderer.invoke(IPC.git.commit, cwd, message, untrackedPaths),
    push: (cwd: string, opts: { setUpstream?: boolean } = {}): Promise<GitPushResult> =>
      ipcRenderer.invoke(IPC.git.push, cwd, opts),
    onOutput: (listener: (chunk: string) => void): (() => void) => {
      const wrapped = (_e: unknown, chunk: string): void => listener(chunk)
      ipcRenderer.on(IPC.git.output, wrapped)
      return () => ipcRenderer.removeListener(IPC.git.output, wrapped)
    }
  },
  dialog: {
    pickDirectory: (): Promise<string | null> => ipcRenderer.invoke(IPC.dialog.pickDirectory),
    pickSavePath: (args: PickSavePathArgs): Promise<string | null> =>
      ipcRenderer.invoke(IPC.dialog.pickSavePath, args),
    confirmUnsaved: (args: ConfirmUnsavedArgs): Promise<UnsavedChoice> =>
      ipcRenderer.invoke(IPC.dialog.confirmUnsaved, args)
  },
  tool: {
    detect: (): Promise<DetectedTools> => ipcRenderer.invoke(IPC.tool.detect)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
