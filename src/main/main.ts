import { app, BrowserWindow, dialog, Menu } from 'electron'
import { statSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, join, resolve } from 'path'
import { IPC } from '../shared/ipc'
import { LocalPtyBackend } from './session/local-pty'
import { LocalFsWorkspaceStore } from './workspace/local-fs'
import { LocalFsContextSource } from './context/local-fs'
import { registerIpc } from './ipc'

// Forge + plugin-vite injects these at build/dev time. Declared rather than
// imported so renderer HTML can come from Vite dev server (URL) in dev and
// from the packaged bundle (file) in production.
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined
declare const MAIN_WINDOW_VITE_NAME: string

// No default menu: File/Edit/View/Window/Help are off-theme for a terminal
// workspace and expose surfaces (zoom, reload, devtools) we don't want users
// bumping into.
Menu.setApplicationMenu(null)

type LaunchRoot = {
  root: string
  invalidArgument: string | null
}

// The project root is what every workspace-keyed thing (per-workspace config,
// notes, default pane cwds) hangs off. Resolution order:
//   1. first positional CLI argument, if it resolves to an existing directory
//   2. process.cwd(), if it is a real, non-filesystem-root directory
//   3. os.homedir() as a neutral, user-owned fallback
// The homedir fallback matters for installed-app launches (Finder, Dock,
// Start Menu, .desktop) where cwd is routinely `/` or a system path we do
// not want to pollute workspace storage with.
function firstPositionalArg(argv: string[], startAt: number): string | null {
  for (let i = startAt; i < argv.length; i++) {
    const a = argv[i]
    if (!a) continue
    if (a === '--') return argv[i + 1] ?? null
    if (a.startsWith('-')) continue
    return a
  }
  return null
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function neutralFallbackRoot(): string {
  const cwd = process.cwd()
  // dirname(p) === p is true only at a filesystem root ('/' on POSIX,
  // 'C:\\' etc. on Windows). Treat those as "no meaningful cwd".
  if (cwd && dirname(cwd) !== cwd && isDirectory(cwd)) return resolve(cwd)
  return homedir()
}

function resolveLaunchRoot(): LaunchRoot {
  // Electron argv shape:
  //   packaged   -> [exePath, ...userArgs]
  //   dev (Forge)-> [electron, appPath, ...userArgs]
  const argvStart = app.isPackaged ? 1 : 2
  const positional = firstPositionalArg(process.argv, argvStart)

  if (positional) {
    const abs = resolve(process.cwd(), positional)
    if (isDirectory(abs)) return { root: abs, invalidArgument: null }
    return { root: neutralFallbackRoot(), invalidArgument: positional }
  }

  return { root: neutralFallbackRoot(), invalidArgument: null }
}

const launch = resolveLaunchRoot()
const projectRoot = launch.root
const projectLabel = basename(projectRoot)
const windowTitle = projectLabel ? `${projectLabel} • ArchiDev-Flow` : 'ArchiDev-Flow'

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0d10',
    title: windowTitle,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // The renderer's index.html carries its own <title>, which Electron would
  // otherwise push back onto the native window and erase the project-scoped
  // label. Veto the update so the main-derived title sticks.
  win.on('page-title-updated', (e) => e.preventDefault())

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    await win.loadFile(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`))
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

  const session = new LocalPtyBackend({
    onData: (id, data) => {
      if (!win.isDestroyed()) win.webContents.send(IPC.pty.data, id, data)
    },
    onExit: (id, info) => {
      if (!win.isDestroyed()) win.webContents.send(IPC.pty.exit, id, info)
    }
  })
  const workspace = new LocalFsWorkspaceStore()
  const context = new LocalFsContextSource()

  // Three-way unsaved-change coordination on window close. The renderer owns
  // the per-pane dirty state and the Save / Don't Save / Cancel dialog, so
  // main vetoes close, asks the renderer to resolve, and only re-issues close
  // once the renderer reports every dirty pane has been handled. The preload
  // buffers the request until React mounts, so no timeout is needed; a truly
  // dead renderer would be stuck regardless.
  let allowClose = false
  let closePending = false

  win.on('close', (e) => {
    if (allowClose) return
    e.preventDefault()
    if (closePending) return
    closePending = true
    if (!win.isDestroyed()) win.webContents.send(IPC.app.requestClose)
  })

  const onCloseResolution = (proceed: boolean): void => {
    if (!closePending) return
    closePending = false
    if (!proceed) return
    allowClose = true
    if (!win.isDestroyed()) win.close()
  }

  registerIpc({ window: win, projectRoot, session, workspace, context, onCloseResolution })

  // PTY teardown lives only in `window-all-closed` (see below). To access the
  // backend from that handler, stash it on a module-level variable.
  closeSession = () => session.closeAll()
}

let closeSession: (() => void) | null = null

app.whenReady().then(() => {
  if (launch.invalidArgument !== null) {
    // Surface the rejected path non-silently. We do not use the argument as-is;
    // the app opens against `launch.root` (cwd or homedir) instead.
    dialog.showErrorBox(
      'ArchiDev-Flow',
      `Ignoring launch argument "${launch.invalidArgument}": not an existing directory.\n` +
        `Opening against ${projectRoot} instead.`
    )
  }
  return createWindow()
})

// PTY teardown lives only here (and not in `before-quit`) because `before-quit`
// fires before the renderer's `beforeunload` can veto the quit for unsaved
// editor changes; tearing down PTYs there would leave terminal panes dead
// after a cancelled quit. `window-all-closed` fires only once windows have
// actually closed, i.e. the quit is really proceeding.
app.on('window-all-closed', () => {
  closeSession?.()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
