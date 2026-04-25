import { useEffect, useState, useCallback, useMemo, type ReactNode } from 'react'
import type { DirEntry } from '../../shared/config'

type Node = DirEntry & {
  children?: Node[]
  expanded?: boolean
  loaded?: boolean
}

type SortMode = 'name-asc' | 'name-desc' | 'mtime-desc' | 'mtime-asc'

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'name-asc', label: 'Name ↑' },
  { value: 'name-desc', label: 'Name ↓' },
  { value: 'mtime-desc', label: 'Modified ↓' },
  { value: 'mtime-asc', label: 'Modified ↑' }
]

// Folders always precede files; `mode` orders within each partition, with name
// as a stable tiebreaker for equal mtimes.
function sortNodes<T extends DirEntry>(nodes: T[], mode: SortMode): T[] {
  const dirs: T[] = []
  const files: T[] = []
  for (const n of nodes) (n.isDir ? dirs : files).push(n)
  const cmp = (a: T, b: T): number => {
    switch (mode) {
      case 'name-asc':
        return a.name.localeCompare(b.name)
      case 'name-desc':
        return b.name.localeCompare(a.name)
      case 'mtime-desc':
        return b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name)
      case 'mtime-asc':
        return a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name)
    }
  }
  dirs.sort(cmp)
  files.sort(cmp)
  return [...dirs, ...files]
}

type Props = {
  root: string
  label: string
  onOpenFile: (path: string) => void
  // Caller-supplied controls that render in the same toolbar as sort/refresh,
  // so wrappers (e.g. the bottom-center Notes/Files toggle) can extend the
  // header without nesting a second pane chrome.
  headerExtras?: ReactNode
}

export function FileTree({ root, label, onOpenFile, headerExtras }: Props): JSX.Element {
  const [tree, setTree] = useState<Node[]>([])
  const [selected, setSelected] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [sortMode, setSortMode] = useState<SortMode>('name-asc')

  const loadRoot = useCallback(async (): Promise<void> => {
    setError('')
    try {
      const entries = await window.api.fs.list(root)
      setTree(entries.map((e) => ({ ...e })))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      setTree([])
    }
  }, [root])

  useEffect(() => {
    loadRoot()
  }, [loadRoot])

  async function toggle(pathToToggle: string): Promise<void> {
    const visit = async (nodes: Node[]): Promise<Node[]> => {
      return Promise.all(
        nodes.map(async (n) => {
          if (n.path === pathToToggle && n.isDir) {
            if (!n.loaded) {
              try {
                const children = await window.api.fs.list(n.path)
                return {
                  ...n,
                  expanded: true,
                  loaded: true,
                  children: children.map((c) => ({ ...c }))
                }
              } catch {
                return { ...n, expanded: true, loaded: true, children: [] }
              }
            }
            return { ...n, expanded: !n.expanded }
          }
          if (n.children) {
            return { ...n, children: await visit(n.children) }
          }
          return n
        })
      )
    }
    setTree(await visit(tree))
  }

  function handleClick(node: Node): void {
    setSelected(node.path)
    if (node.isDir) {
      toggle(node.path)
    } else {
      onOpenFile(node.path)
    }
  }

  const sortedTree = useMemo(() => {
    const sortDeep = (nodes: Node[]): Node[] =>
      sortNodes(nodes, sortMode).map((n) =>
        n.children ? { ...n, children: sortDeep(n.children) } : n
      )
    return sortDeep(tree)
  }, [tree, sortMode])

  function renderNodes(nodes: Node[], depth: number): JSX.Element[] {
    const out: JSX.Element[] = []
    for (const n of nodes) {
      out.push(
        <div
          key={n.path}
          className={`tree-item${selected === n.path ? ' selected' : ''}`}
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => handleClick(n)}
          title={n.path}
        >
          <span className="chev">{n.isDir ? (n.expanded ? '▾' : '▸') : ''}</span>
          <span className="icon">{n.isDir ? '📁' : '·'}</span>
          <span className="name">{n.name}</span>
        </div>
      )
      if (n.isDir && n.expanded && n.children) {
        out.push(...renderNodes(n.children, depth + 1))
      }
    }
    return out
  }

  return (
    <div className="pane">
      <div className="pane-header">
        <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
          <span className="label">{label}</span>
          <span className="path" title={root}>{root}</span>
        </div>
        <div className="toolbar">
          {headerExtras}
          <select
            className="sort-select"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            title="Sort order"
            aria-label="Sort order"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button onClick={loadRoot} title="Refresh">↻</button>
        </div>
      </div>
      <div className="tree" tabIndex={0}>
        {error && <div className="tree-item status-err" style={{ paddingLeft: 8 }}>{error}</div>}
        {renderNodes(sortedTree, 0)}
      </div>
    </div>
  )
}
