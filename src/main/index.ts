import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { registerIpc } from './ipc'
import { closeAllPtys } from './pty'

const isDev = !app.isPackaged

// Project root is the directory the user launched from. In dev (electron-vite),
// it's this repo. In a packaged app invoked from a project shell, it's that
// project's cwd.
const projectRoot = process.cwd()

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0d10',
    title: 'ArchiDev-Flow',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    await win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  registerIpc(win, projectRoot)
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  closeAllPtys()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('before-quit', () => {
  closeAllPtys()
})
