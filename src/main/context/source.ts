import type { DirEntry } from '../../shared/config'

// ContextSource is the read/write contract the renderer has against files
// that back editor panes and the file-tree. A future non-local context source
// (e.g. a remote repo view) would implement this interface. Only a local
// filesystem implementation exists today and nothing else is planned.
export interface ContextSource {
  list(dir: string): Promise<DirEntry[]>
  read(path: string): Promise<string>
  write(path: string, content: string): Promise<void>
}
