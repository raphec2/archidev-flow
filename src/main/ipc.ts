import { ipcMain, BrowserWindow, dialog } from 'electron'
import {
  IPC,
  type PtyOpenArgs,
  type ConfirmUnsavedArgs,
  type PickSavePathArgs,
  type UnsavedChoice
} from '../shared/ipc'
import type { Config } from '../shared/config'
import type { SessionBackend } from './session/backend'
import type { WorkspaceStore } from './workspace/store'
import type { ContextSource } from './context/source'
import { getGitStatus, runCommit, runPush } from './git'
import { detectTools } from './detect'

export type IpcDeps = {
  window: BrowserWindow
  projectRoot: string
  session: SessionBackend
  workspace: WorkspaceStore
  context: ContextSource
}

export function registerIpc(deps: IpcDeps): void {
  const { window, projectRoot, session, workspace, context } = deps

  ipcMain.handle(IPC.app.getProjectRoot, () => projectRoot)

  ipcMain.handle(IPC.config.load, () => workspace.loadOrCreate(projectRoot))
  ipcMain.handle(IPC.config.save, async (_e, cfg: Config) => {
    await workspace.save(projectRoot, cfg)
    return true
  })

  ipcMain.handle(IPC.pty.open, (_e, args: PtyOpenArgs) => {
    session.open(args)
    return true
  })
  ipcMain.handle(IPC.pty.write, (_e, id: string, data: string) => {
    session.write(id, data)
    return true
  })
  ipcMain.handle(IPC.pty.resize, (_e, id: string, cols: number, rows: number) => {
    session.resize(id, cols, rows)
    return true
  })
  ipcMain.handle(IPC.pty.close, (_e, id: string) => {
    session.close(id)
    return true
  })

  ipcMain.handle(IPC.fs.list, (_e, dir: string) => context.list(dir))
  ipcMain.handle(IPC.fs.read, (_e, path: string) => context.read(path))
  ipcMain.handle(IPC.fs.write, (_e, path: string, content: string) =>
    context.write(path, content)
  )

  ipcMain.handle(IPC.git.status, (_e, cwd: string) => getGitStatus(cwd))

  ipcMain.handle(
    IPC.git.commit,
    (_e, cwd: string, message: string, untrackedPaths: string[] = []) =>
      runCommit(cwd, message, untrackedPaths, (chunk) => {
        if (!window.isDestroyed()) window.webContents.send(IPC.git.output, chunk)
      })
  )

  ipcMain.handle(
    IPC.git.push,
    (_e, cwd: string, opts: { setUpstream?: boolean } = {}) =>
      runPush(cwd, opts, (chunk) => {
        if (!window.isDestroyed()) window.webContents.send(IPC.git.output, chunk)
      })
  )

  ipcMain.handle(IPC.dialog.pickDirectory, async () => {
    const r = await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle(IPC.dialog.pickSavePath, async (_e, args: PickSavePathArgs) => {
    const r = await dialog.showSaveDialog(window, {
      title: args.title || 'Choose save location',
      defaultPath: args.defaultPath,
      properties: ['showOverwriteConfirmation', 'createDirectory']
    })
    return r.canceled ? null : r.filePath ?? null
  })

  ipcMain.handle(
    IPC.dialog.confirmUnsaved,
    async (_e, args: ConfirmUnsavedArgs): Promise<UnsavedChoice> => {
      const r = await dialog.showMessageBox(window, {
        type: 'warning',
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
        title: 'Unsaved changes',
        message: `"${args.name}" has unsaved changes.`,
        detail: `Save your changes before you ${args.action}?`
      })
      if (r.response === 0) return 'save'
      if (r.response === 1) return 'discard'
      return 'cancel'
    }
  )

  ipcMain.handle(IPC.tool.detect, () => detectTools())
}
