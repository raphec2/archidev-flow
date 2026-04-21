import type { GitFileChange } from '../shared/config'

export type ChangeDescription = {
  tag: 'add' | 'modify' | 'delete' | 'rename' | 'conflict' | 'other'
  short: string
}

export type DraftEntry = { path: string; kind: ChangeDescription['tag'] }

export function describeChange(c: GitFileChange): ChangeDescription {
  const i = c.index
  const w = c.worktree
  if (i === 'U' || w === 'U' || (i === 'A' && w === 'A') || (i === 'D' && w === 'D')) {
    return { tag: 'conflict', short: 'UU' }
  }
  if (i === 'A' || w === 'A') return { tag: 'add', short: 'A' }
  if (i === 'D' || w === 'D') return { tag: 'delete', short: 'D' }
  if (i === 'R' || w === 'R') return { tag: 'rename', short: 'R' }
  if (i === 'M' || w === 'M') return { tag: 'modify', short: 'M' }
  return { tag: 'other', short: (i + w).trim() || '·' }
}

function basename(p: string): string {
  // Handle rename syntax "orig -> new" by taking the destination path.
  const arrow = p.indexOf(' -> ')
  const target = arrow >= 0 ? p.slice(arrow + 4) : p
  const i = target.lastIndexOf('/')
  return i >= 0 ? target.slice(i + 1) : target
}

// Narrow automation: produce a predictable starting point for a commit message
// that the user is expected to review. No clever inference — just a verb and a
// few changed file basenames. Scope is what the dialog will actually commit
// (tracked changes plus any opted-in untracked files), not the full working
// tree.
export function draftCommitMessage(entries: DraftEntry[]): string {
  if (entries.length === 0) return ''

  const allAdd = entries.every((e) => e.kind === 'add')
  const allDel = entries.every((e) => e.kind === 'delete')
  const verb = allAdd ? 'add' : allDel ? 'remove' : 'update'

  const names = entries.map((e) => basename(e.path))
  const shown = names.slice(0, 3).join(', ')
  const more = names.length > 3 ? `, +${names.length - 3} more` : ''
  return `${verb}: ${shown}${more}`
}
