import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { Config } from '../shared/config'

const CONFIG_FILE = 'config.json'

export function getConfigPath(): string {
  return join(app.getPath('userData'), CONFIG_FILE)
}

export function getDefaultNotesPath(): string {
  return join(app.getPath('userData'), 'notes.md')
}

function isWin(): boolean {
  return process.platform === 'win32'
}

function defaultShell(): string {
  if (isWin()) return 'powershell.exe'
  return process.env.SHELL || '/bin/bash'
}

export function defaultConfig(projectRoot: string): Config {
  return {
    consultant_dir: projectRoot,
    consultant_tool: defaultShell(),
    developer_dir: projectRoot,
    developer_tool: defaultShell(),
    layout: {
      mainVertical: [65, 35],
      topHorizontal: [50, 50],
      bottomHorizontal: [50, 50],
      developerInner: [25, 75],
      consultantInner: [25, 75]
    },
    consultantExplorerVisible: false,
    editors: [
      { id: 'notes', name: 'Notes', filePath: null, isNotes: true },
      { id: 'file', name: 'File', filePath: null, isNotes: false }
    ],
    notesPath: getDefaultNotesPath(),
    lastOpenedFiles: [],
    onboardingComplete: false
  }
}

export async function loadOrCreateConfig(projectRoot: string): Promise<Config> {
  const path = getConfigPath()
  const fallback = defaultConfig(projectRoot)
  try {
    const raw = await fs.readFile(path, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<Config>
    return { ...fallback, ...parsed, layout: { ...fallback.layout, ...(parsed.layout || {}) } }
  } catch {
    await fs.writeFile(path, JSON.stringify(fallback, null, 2), 'utf-8')
    // Initialize empty notes file if missing.
    try {
      await fs.access(fallback.notesPath)
    } catch {
      await fs.writeFile(fallback.notesPath, '', 'utf-8')
    }
    return fallback
  }
}

export async function saveConfig(cfg: Config): Promise<void> {
  await fs.writeFile(getConfigPath(), JSON.stringify(cfg, null, 2), 'utf-8')
}
