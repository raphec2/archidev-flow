import { promises as fs } from 'fs'
import { join } from 'path'
import type { DirEntry } from '../../shared/config'
import type { ContextSource } from './source'

export class LocalFsContextSource implements ContextSource {
  async list(dir: string): Promise<DirEntry[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const visible = entries.filter(
      (e) => !e.name.startsWith('.') || e.name === '.env' || e.name === '.gitignore'
    )
    const withStats = await Promise.all(
      visible.map(async (e) => {
        const full = join(dir, e.name)
        // Tolerate per-entry stat failures (broken symlinks, permission denied)
        // so a single bad child doesn't blank the whole listing.
        let mtimeMs = 0
        try {
          mtimeMs = (await fs.lstat(full)).mtimeMs
        } catch {}
        return { name: e.name, path: full, isDir: e.isDirectory(), mtimeMs }
      })
    )
    return withStats.sort((a, b) =>
      a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1
    )
  }

  read(path: string): Promise<string> {
    return fs.readFile(path, 'utf-8')
  }

  async write(path: string, content: string): Promise<void> {
    await fs.writeFile(path, content, 'utf-8')
  }
}
