import { app } from 'electron'
import { promises as fs } from 'fs'
import { createHash } from 'crypto'
import { join, resolve } from 'path'
import type { Config } from '../shared/config'

const LEGACY_CONFIG_FILE = 'config.json'
const LEGACY_ARCHIVE_FILE = 'config.legacy.json'
const WORKSPACES_DIR = 'workspaces'
const WORKSPACE_CONFIG = 'config.json'
const WORKSPACE_NOTES = 'notes.md'
const WORKSPACE_META = 'meta.json'

function workspaceKey(projectRoot: string): string {
  // Absolute path, platform-default casing. Short hash keeps it fs-safe and
  // human-scannable via `ls userData/workspaces`.
  const normalized = resolve(projectRoot)
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

function workspaceDir(projectRoot: string): string {
  return join(app.getPath('userData'), WORKSPACES_DIR, workspaceKey(projectRoot))
}

export function getConfigPath(projectRoot: string): string {
  return join(workspaceDir(projectRoot), WORKSPACE_CONFIG)
}

export function getDefaultNotesPath(projectRoot: string): string {
  return join(workspaceDir(projectRoot), WORKSPACE_NOTES)
}

function legacyConfigPath(): string {
  return join(app.getPath('userData'), LEGACY_CONFIG_FILE)
}

function legacyArchivePath(): string {
  return join(app.getPath('userData'), LEGACY_ARCHIVE_FILE)
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
    notesPath: getDefaultNotesPath(projectRoot),
    lastOpenedFiles: [],
    onboardingComplete: false
  }
}

async function readJsonIfExists<T>(path: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(path, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

async function writeWorkspaceMeta(projectRoot: string): Promise<void> {
  const meta = {
    projectRoot: resolve(projectRoot),
    createdAt: new Date().toISOString()
  }
  await fs.writeFile(
    join(workspaceDir(projectRoot), WORKSPACE_META),
    JSON.stringify(meta, null, 2),
    'utf-8'
  )
}

// One-time migration: if a legacy userData/config.json exists, consume it as
// the seed for the first workspace to load post-upgrade, then rename it so
// later workspaces start from defaults instead of inheriting stranger state.
async function consumeLegacySeed(): Promise<Partial<Config> | null> {
  const legacy = await readJsonIfExists<Partial<Config>>(legacyConfigPath())
  if (!legacy) return null
  try {
    await fs.rename(legacyConfigPath(), legacyArchivePath())
  } catch {
    try {
      await fs.unlink(legacyConfigPath())
    } catch {
      /* best-effort: the in-memory snapshot is still used below */
    }
  }
  return legacy
}

export async function loadOrCreateConfig(projectRoot: string): Promise<Config> {
  await fs.mkdir(workspaceDir(projectRoot), { recursive: true })
  const path = getConfigPath(projectRoot)
  const fallback = defaultConfig(projectRoot)

  const existing = await readJsonIfExists<Partial<Config>>(path)
  if (existing) {
    return {
      ...fallback,
      ...existing,
      layout: { ...fallback.layout, ...(existing.layout || {}) }
    }
  }

  const legacySeed = await consumeLegacySeed()
  const seeded: Config = legacySeed
    ? {
        ...fallback,
        ...legacySeed,
        layout: { ...fallback.layout, ...(legacySeed.layout || {}) },
        // Preserve legacy notesPath so migrated notes content isn't orphaned.
        // Fresh workspaces fall back to the workspace-scoped default above.
        notesPath: legacySeed.notesPath || fallback.notesPath
      }
    : fallback

  await fs.writeFile(path, JSON.stringify(seeded, null, 2), 'utf-8')
  await writeWorkspaceMeta(projectRoot)

  if (seeded.notesPath === fallback.notesPath) {
    try {
      await fs.access(seeded.notesPath)
    } catch {
      await fs.writeFile(seeded.notesPath, '', 'utf-8')
    }
  }

  return seeded
}

export async function saveConfig(projectRoot: string, cfg: Config): Promise<void> {
  await fs.mkdir(workspaceDir(projectRoot), { recursive: true })
  await fs.writeFile(getConfigPath(projectRoot), JSON.stringify(cfg, null, 2), 'utf-8')
}
