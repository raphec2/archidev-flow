import { ipcMain, BrowserWindow, dialog } from 'electron'
import { loadOrCreateConfig, saveConfig } from './config'
import { openPty, writePty, resizePty, closePty } from './pty'
import { listDir, readFile, writeFile } from './fsops'
import { runGitSync } from './git'
import type { Config } from '../shared/config'

export function registerIpc(win: BrowserWindow, projectRoot: string): void {
  ipcMain.handle('app:getProjectRoot', () => projectRoot)

  ipcMain.handle('config:load', async () => loadOrCreateConfig(projectRoot))
  ipcMain.handle('config:save', async (_e, cfg: Config) => {
    await saveConfig(cfg)
    return true
  })

  ipcMain.handle(
    'pty:open',
    (_e, args: { id: string; cwd: string; command: string; cols: number; rows: number }) => {
      openPty({ ...args, window: win })
      return true
    }
  )
  ipcMain.handle('pty:write', (_e, id: string, data: string) => {
    writePty(id, data)
    return true
  })
  ipcMain.handle('pty:resize', (_e, id: string, cols: number, rows: number) => {
    resizePty(id, cols, rows)
    return true
  })
  ipcMain.handle('pty:close', (_e, id: string) => {
    closePty(id)
    return true
  })

  ipcMain.handle('fs:list', (_e, dir: string) => listDir(dir))
  ipcMain.handle('fs:read', (_e, path: string) => readFile(path))
  ipcMain.handle('fs:write', (_e, path: string, content: string) => writeFile(path, content))

  ipcMain.handle('git:sync', async (_e, cwd: string, message: string) => {
    const chunks: string[] = []
    const result = await runGitSync(cwd, message, (chunk) => {
      chunks.push(chunk)
      if (!win.isDestroyed()) win.webContents.send('git:output', chunk)
    })
    return { ...result, output: chunks.join('') }
  })

  ipcMain.handle('dialog:pickDirectory', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
}
