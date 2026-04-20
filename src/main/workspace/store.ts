import type { Config } from '../../shared/config'

// WorkspaceStore is the persistence boundary. A future alternate backend (e.g.
// encrypted, network-mounted) would implement this interface. Only a local
// filesystem impl exists today and nothing else is planned.
export interface WorkspaceStore {
  loadOrCreate(projectRoot: string): Promise<Config>
  save(projectRoot: string, cfg: Config): Promise<void>
  defaultNotesPath(projectRoot: string): string
}
