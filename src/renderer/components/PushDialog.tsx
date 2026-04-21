import { useEffect, useRef, useState } from 'react'
import type { GitPushResult, GitStatus } from '../../shared/config'

type Props = {
  cwd: string
  status: GitStatus
  onClose: () => void
  onPushed: () => void
}

type Phase = 'review' | 'running' | 'done'

export function PushDialog({ cwd, status, onClose, onPushed }: Props): JSX.Element {
  const [phase, setPhase] = useState<Phase>('review')
  const [output, setOutput] = useState('')
  const [result, setResult] = useState<GitPushResult | null>(null)
  const outRef = useRef<HTMLPreElement | null>(null)

  useEffect(() => {
    const off = window.api.git.onOutput((chunk) => {
      setOutput((prev) => prev + chunk)
      requestAnimationFrame(() => {
        if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight
      })
    })
    return off
  }, [])

  const branch = status.branch ?? '(unknown)'
  const needsPublish = !status.detached && !status.upstream
  const canPush = !!status.upstream && status.ahead > 0
  const nothingToDo = !needsPublish && !canPush

  async function run(): Promise<void> {
    setPhase('running')
    setOutput('')
    const r = await window.api.git.push(cwd, { setUpstream: needsPublish })
    setResult(r)
    setPhase('done')
    if (r.ok) onPushed()
  }

  const destination = needsPublish
    ? `origin/${branch} (new)`
    : status.upstream ?? 'upstream'

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && phase !== 'running') onClose()
      }}
    >
      <div className="modal">
        <div className="modal-header">
          Push — <span className="branch-inline">{branch}</span>
          {status.detached && <span className="status-warn"> (detached)</span>}
        </div>
        <div className="modal-body">
          {phase === 'review' && (
            <>
              <div className="push-summary">
                <div>
                  <span className="push-label">From</span>
                  <code>{branch}</code>
                </div>
                <div>
                  <span className="push-label">To</span>
                  <code>{destination}</code>
                </div>
                <div>
                  <span className="push-label">State</span>
                  {status.detached ? (
                    <span className="status-warn">detached HEAD</span>
                  ) : needsPublish ? (
                    <span className="status-warn">no upstream set</span>
                  ) : status.ahead === 0 ? (
                    <span className="status-warn">nothing to push (0 ahead)</span>
                  ) : (
                    <span>
                      {status.ahead} commit{status.ahead === 1 ? '' : 's'} ahead
                      {status.behind > 0 && `, ${status.behind} behind`}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ color: 'var(--text-2)', fontSize: 11 }}>
                {needsPublish ? (
                  <>
                    Runs <code>git push -u origin {branch}</code> to publish and
                    set upstream.
                  </>
                ) : (
                  <>
                    Runs <code>git push</code>. Stays on the branch shown above.
                  </>
                )}
              </div>
            </>
          )}
          {(phase === 'running' || phase === 'done') && (
            <>
              <pre ref={outRef}>{output || '…'}</pre>
              {phase === 'done' && result && (
                <div className={result.ok ? 'status-ok' : 'status-err'}>
                  {result.ok
                    ? result.setUpstream
                      ? `Published to ${result.remote}/${result.branch ?? branch}.`
                      : 'Push complete.'
                    : `Push failed (exit ${result.code}).`}
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
                disabled={nothingToDo || status.detached}
                title={
                  status.detached
                    ? 'Cannot push from detached HEAD'
                    : nothingToDo
                      ? 'Nothing to push'
                      : undefined
                }
              >
                {needsPublish ? `Publish to origin/${branch}` : 'Push'}
              </button>
            </>
          )}
          {phase === 'running' && <button disabled>Pushing…</button>}
          {phase === 'done' && <button onClick={onClose}>Close</button>}
        </div>
      </div>
    </div>
  )
}
