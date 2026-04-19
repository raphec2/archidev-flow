import { app, BrowserWindow, Menu } from 'electron'
import { join } from 'path'
import { registerIpc } from './ipc'
import { closeAllPtys } from './pty'

// No default menu: File/Edit/View/Window/Help are off-theme for a terminal
// workspace and expose surfaces (zoom, reload, devtools) we don't want users
// bumping into. macOS keeps an app menu by convention; platforms where
// setApplicationMenu(null) is honoured get a clean frame.
Menu.setApplicationMenu(null)

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
    autoHideMenuBar: true,
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

  win.webContents.on('context-menu', (_e, params) => {
    const { editFlags, selectionText, isEditable } = params
    const hasSelection = !!(selectionText && selectionText.length > 0)
    const template: Electron.MenuItemConstructorOptions[] = []
    if (isEditable) {
      template.push(
        { label: 'Cut', role: 'cut', enabled: editFlags.canCut },
        { label: 'Copy', role: 'copy', enabled: editFlags.canCopy },
        { label: 'Paste', role: 'paste', enabled: editFlags.canPaste },
        { type: 'separator' },
        { label: 'Select All', role: 'selectAll', enabled: editFlags.canSelectAll }
      )
    } else if (hasSelection) {
      template.push({ label: 'Copy', role: 'copy' })
    }
    if (template.length === 0) return
    Menu.buildFromTemplate(template).popup({ window: win })
  })

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
