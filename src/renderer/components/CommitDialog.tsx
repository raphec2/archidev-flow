import { useEffect, useMemo, useRef, useState } from 'react'
import type { GitStatus, GitFileChange, GitCommitResult } from '../../shared/config'
import {
  describeChange,
  draftCommitMessage,
  type DraftEntry
} from '../git-status'

type Props = {
  cwd: string
  status: GitStatus
  onClose: () => void
  onCommitted: () => void
}

type Phase = 'review' | 'running' | 'done'

export function CommitDialog({ cwd, status, onClose, onCommitted }: Props): JSX.Element {
  const [phase, setPhase] = useState<Phase>('review')
  const [includedUntracked, setIncludedUntracked] = useState<Set<string>>(
    () => new Set()
  )
  const [message, setMessage] = useState('')
  const [userEditedMessage, setUserEditedMessage] = useState(false)
  const [output, setOutput] = useState('')
  const [result, setResult] = useState<GitCommitResult | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const outRef = useRef<HTMLPreElement | null>(null)

  // Scope = what will actually be committed: tracked changes (default) plus any
  // explicitly opted-in untracked files.
  const scopeEntries = useMemo<DraftEntry[]>(() => {
    const entries: DraftEntry[] = []
    for (const c of status.tracked) {
      entries.push({ path: c.path, kind: describeChange(c).tag })
    }
    for (const p of status.untracked) {
      if (includedUntracked.has(p)) entries.push({ path: p, kind: 'add' })
    }
    return entries
  }, [status.tracked, status.untracked, includedUntracked])

  const currentDraft = useMemo(() => draftCommitMessage(scopeEntries), [scopeEntries])

  // Keep the draft synced with scope while the user hasn't customised it.
  // Once they type, we stop overwriting their message on scope changes.
  useEffect(() => {
    if (!userEditedMessage) setMessage(currentDraft)
  }, [currentDraft, userEditedMessage])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const off = window.api.git.onOutput((chunk) => {
      setOutput((prev) => prev + chunk)
      requestAnimationFrame(() => {
        if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight
      })
    })
    return off
  }, [])

  const branchLabel = status.branch ?? '(unknown)'
  const hasScope = scopeEntries.length > 0
  const untrackedList = status.untracked

  function toggleUntracked(path: string): void {
    setIncludedUntracked((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }
  function includeAllUntracked(): void {
    setIncludedUntracked(new Set(untrackedList))
  }
  function clearUntracked(): void {
    setIncludedUntracked(new Set())
  }

  function onMessageChange(next: string): void {
    setMessage(next)
    setUserEditedMessage(next !== currentDraft)
  }

  async function run(): Promise<void> {
    const trimmed = message.trim()
    if (!trimmed || !hasScope) return
    setPhase('running')
    setOutput('')
    const paths = Array.from(includedUntracked)
    const r = await window.api.git.commit(cwd, trimmed, paths)
    setResult(r)
    setPhase('done')
    if (r.ok) onCommitted()
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && phase !== 'running') onClose()
      }}
    >
      <div className="modal">
        <div className="modal-header">
          Commit — <span className="branch-inline">{branchLabel}</span>
          {status.detached && <span className="status-warn"> (detached)</span>}
        </div>
        <div className="modal-body">
          {phase === 'review' && (
            <>
              <TrackedSection tracked={status.tracked} cwd={cwd} />
              <UntrackedSection
                untracked={untrackedList}
                included={includedUntracked}
                onToggle={toggleUntracked}
                onIncludeAll={includeAllUntracked}
                onClear={clearUntracked}
              />
              <label>Commit message</label>
              <textarea
                ref={inputRef}
                value={message}
                onChange={(e) => onMessageChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run()
                }}
                rows={3}
                placeholder="feat: …"
              />
              <div style={{ color: 'var(--text-2)', fontSize: 11 }}>
                Stages tracked changes with <code>git add -u</code>
                {includedUntracked.size > 0 && (
                  <>
                    {' '}
                    plus {includedUntracked.size} opted-in untracked file
                    {includedUntracked.size === 1 ? '' : 's'}
                  </>
                )}
                , then <code>git commit -m &lt;msg&gt;</code>. Push is a separate
                action.
              </div>
            </>
          )}
          {(phase === 'running' || phase === 'done') && (
            <>
              <pre ref={outRef}>{output || '…'}</pre>
              {phase === 'done' && result && (
                <div className={result.ok ? 'status-ok' : 'status-err'}>
                  {result.ok
                    ? 'Commit created.'
                    : result.step === 'empty'
                      ? 'Nothing to commit.'
                      : `Failed at ${result.step} (exit ${result.code}).`}
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-footer">
          {phase === 'review' && (
            <>
              <button onClick={onClose}>Cancel</button>
              <button
                onClick={run}
                disabled={!message.trim() || !hasScope}
                title={!hasScope ? 'Nothing selected to commit' : undefined}
              >
                Commit {scopeEntries.length} file
                {scopeEntries.length === 1 ? '' : 's'}
              </button>
            </>
          )}
          {phase === 'running' && <button disabled>Committing…</button>}
          {phase === 'done' && <button onClick={onClose}>Close</button>}
        </div>
      </div>
    </div>
  )
}

function TrackedSection({
  tracked,
  cwd
}: {
  tracked: GitFileChange[]
  cwd: string
}): JSX.Element {
  const count = tracked.length
  return (
    <div className="change-list">
      <div className="change-list-head" title={cwd}>
        <span className="change-section-label">Tracked changes</span>
        <span className="change-section-count">
          {count} file{count === 1 ? '' : 's'}
          {count > 0 ? ' · included by default' : ''}
        </span>
      </div>
      {count === 0 ? (
        <div className="change-list-empty">No tracked changes.</div>
      ) : (
        <ul>
          {tracked.map((c) => (
            <li key={c.path}>
              <span className={`change-tag tag-${describeChange(c).tag}`}>
                {describeChange(c).short}
              </span>
              <span className="change-path">{c.path}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function UntrackedSection({
  untracked,
  included,
  onToggle,
  onIncludeAll,
  onClear
}: {
  untracked: string[]
  included: Set<string>
  onToggle: (path: string) => void
  onIncludeAll: () => void
  onClear: () => void
}): JSX.Element | null {
  if (untracked.length === 0) return null
  const selectedCount = included.size
  return (
    <div className="change-list">
      <div className="change-list-head">
        <span className="change-section-label">Untracked files</span>
        <span className="change-section-count">
          {selectedCount}/{untracked.length} selected · opt-in only
        </span>
        <span className="change-section-actions">
          <button
            type="button"
            className="link-button"
            onClick={onIncludeAll}
            disabled={selectedCount === untracked.length}
          >
            Include all
          </button>
          <button
            type="button"
            className="link-button"
            onClick={onClear}
            disabled={selectedCount === 0}
          >
            Clear
          </button>
        </span>
      </div>
      <ul>
        {untracked.map((p) => {
          const checked = included.has(p)
          return (
            <li key={p} className={checked ? 'untracked-row checked' : 'untracked-row'}>
              <label>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(p)}
                />
                <span
                  className={`change-tag tag-untracked${checked ? ' tag-on' : ''}`}
                >
                  ??
                </span>
                <span className="change-path">{p}</span>
              </label>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
