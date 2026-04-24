import { app } from 'electron'
import { promises as fs } from 'fs'
import { createHash } from 'crypto'
import { join, resolve } from 'path'
import type { Config } from '../../shared/config'
import type { WorkspaceStore } from './store'

const LEGACY_CONFIG_FILE = 'config.json'
const LEGACY_ARCHIVE_FILE = 'config.legacy.json'
const WORKSPACES_DIR = 'workspaces'
const WORKSPACE_CONFIG = 'config.json'
const WORKSPACE_NOTES = 'notes.md'
const WORKSPACE_META = 'meta.json'

function isWin(): boolean {
  return process.platform === 'win32'
}

function defaultShell(): string {
  if (isWin()) return 'powershell.exe'
  return process.env.SHELL || '/bin/bash'
}

function workspaceKey(projectRoot: string): string {
  // Absolute path, short sha256 — fs-safe and human-scannable via
  // `ls userData/workspaces`. Meta.json records the full path.
  const normalized = resolve(projectRoot)
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

function workspaceDir(projectRoot: string): string {
  return join(app.getPath('userData'), WORKSPACES_DIR, workspaceKey(projectRoot))
}

async function readJsonIfExists<T>(path: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(path, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export class LocalFsWorkspaceStore implements WorkspaceStore {
  defaultNotesPath(projectRoot: string): string {
    return join(workspaceDir(projectRoot), WORKSPACE_NOTES)
  }

  private configPath(projectRoot: string): string {
    return join(workspaceDir(projectRoot), WORKSPACE_CONFIG)
  }

  private legacyConfigPath(): string {
    return join(app.getPath('userData'), LEGACY_CONFIG_FILE)
  }

  private legacyArchivePath(): string {
    return join(app.getPath('userData'), LEGACY_ARCHIVE_FILE)
  }

  private defaultConfig(projectRoot: string): Config {
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
      developerExplorerVisible: true,
      editors: [
        { id: 'notes', name: 'Notes', filePath: null, isNotes: true },
        { id: 'file', name: 'Right Editor', filePath: null, isNotes: false }
      ],
      notesPath: this.defaultNotesPath(projectRoot),
      lastOpenedFiles: [],
      onboardingComplete: false
    }
  }

  private async writeMeta(projectRoot: string): Promise<void> {
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

  // One-shot migration: a legacy userData/config.json (from v1 pre per-workspace
  // storage) seeds the first post-upgrade workspace, then is archived so later
  // workspaces start from defaults instead of inheriting stranger state.
  private async consumeLegacySeed(): Promise<Partial<Config> | null> {
    const legacy = await readJsonIfExists<Partial<Config>>(this.legacyConfigPath())
    if (!legacy) return null
    try {
      await fs.rename(this.legacyConfigPath(), this.legacyArchivePath())
    } catch {
      try {
        await fs.unlink(this.legacyConfigPath())
      } catch {
        /* best-effort: the in-memory snapshot is still used below */
      }
    }
    return legacy
  }

  async loadOrCreate(projectRoot: string): Promise<Config> {
    await fs.mkdir(workspaceDir(projectRoot), { recursive: true })
    const path = this.configPath(projectRoot)
    const fallback = this.defaultConfig(projectRoot)

    const existing = await readJsonIfExists<Partial<Config>>(path)
    if (existing) {
      return {
        ...fallback,
        ...existing,
        layout: { ...fallback.layout, ...(existing.layout || {}) }
      }
    }

    const legacySeed = await this.consumeLegacySeed()
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
    await this.writeMeta(projectRoot)

    if (seeded.notesPath === fallback.notesPath) {
      try {
        await fs.access(seeded.notesPath)
      } catch {
        await fs.writeFile(seeded.notesPath, '', 'utf-8')
      }
    }

    return seeded
  }

  async save(projectRoot: string, cfg: Config): Promise<void> {
    await fs.mkdir(workspaceDir(projectRoot), { recursive: true })
    await fs.writeFile(this.configPath(projectRoot), JSON.stringify(cfg, null, 2), 'utf-8')
  }
}
