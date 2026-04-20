import { promises as fs } from 'fs'
import { join } from 'path'
import type { DirEntry } from '../../shared/config'
import type { ContextSource } from './source'

export class LocalFsContextSource implements ContextSource {
  async list(dir: string): Promise<DirEntry[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries
      .filter((e) => !e.name.startsWith('.') || e.name === '.env' || e.name === '.gitignore')
      .map((e) => ({ name: e.name, path: join(dir, e.name), isDir: e.isDirectory() }))
      .sort((a, b) =>
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
