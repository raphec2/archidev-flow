import { useEffect, useState, useCallback } from 'react'
import type { DirEntry } from '../../shared/config'

type Node = DirEntry & {
  children?: Node[]
  expanded?: boolean
  loaded?: boolean
}

type Props = {
  root: string
  label: string
  onOpenFile: (path: string) => void
}

export function FileTree({ root, label, onOpenFile }: Props): JSX.Element {
  const [tree, setTree] = useState<Node[]>([])
  const [selected, setSelected] = useState<string>('')
  const [error, setError] = useState<string>('')

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
          <button onClick={loadRoot} title="Refresh">↻</button>
        </div>
      </div>
      <div className="tree">
        {error && <div className="tree-item status-err" style={{ paddingLeft: 8 }}>{error}</div>}
        {renderNodes(tree, 0)}
      </div>
    </div>
  )
}
