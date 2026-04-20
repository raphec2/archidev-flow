import { ipcMain, BrowserWindow, dialog } from 'electron'
import { IPC, type PtyOpenArgs } from '../shared/ipc'
import type { Config } from '../shared/config'
import type { SessionBackend } from './session/backend'
import type { WorkspaceStore } from './workspace/store'
import type { ContextSource } from './context/source'
import { runGitSync } from './git'
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

  ipcMain.handle(IPC.git.sync, async (_e, cwd: string, message: string) => {
    const chunks: string[] = []
    const result = await runGitSync(cwd, message, (chunk) => {
      chunks.push(chunk)
      if (!window.isDestroyed()) window.webContents.send(IPC.git.output, chunk)
    })
    return { ...result, output: chunks.join('') }
  })

  ipcMain.handle(IPC.dialog.pickDirectory, async () => {
    const r = await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle(IPC.tool.detect, () => detectTools())
}
