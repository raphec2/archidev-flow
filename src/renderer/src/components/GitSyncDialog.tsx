import { useEffect, useRef, useState } from 'react'

type Props = {
  cwd: string
  onClose: () => void
}

type Phase = 'input' | 'running' | 'done'

export function GitSyncDialog({ cwd, onClose }: Props): JSX.Element {
  const [phase, setPhase] = useState<Phase>('input')
  const [message, setMessage] = useState('')
  const [output, setOutput] = useState('')
  const [result, setResult] = useState<{ ok: boolean; step: string; code: number } | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const outRef = useRef<HTMLPreElement | null>(null)

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

  async function run(): Promise<void> {
    const trimmed = message.trim()
    if (!trimmed) return
    setPhase('running')
    setOutput('')
    const r = await window.api.git.sync(cwd, trimmed)
    setResult({ ok: r.ok, step: r.step, code: r.code })
    setPhase('done')
  }

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && phase !== 'running') onClose() }}>
      <div className="modal">
        <div className="modal-header">Sync &amp; Push — {cwd}</div>
        <div className="modal-body">
          {phase === 'input' && (
            <>
              <label>Commit message</label>
              <input
                ref={inputRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') run() }}
                placeholder="feat: …"
              />
              <div style={{ color: 'var(--text-2)', fontSize: 11 }}>
                Runs: <code>git add .</code> → <code>git commit -m &lt;msg&gt;</code> → <code>git push</code>.
                If there is nothing to commit, the push still runs.
              </div>
            </>
          )}
          {(phase === 'running' || phase === 'done') && (
            <>
              <pre ref={outRef}>{output || '…'}</pre>
              {phase === 'done' && result && (
                <div className={result.ok ? 'status-ok' : 'status-err'}>
                  {result.ok
                    ? 'Success.'
                    : `Failed at ${result.step} (exit ${result.code}). See output above.`}
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-footer">
          {phase === 'input' && (
            <>
              <button onClick={onClose}>Cancel</button>
              <button onClick={run} disabled={!message.trim()}>Run</button>
            </>
          )}
          {phase === 'running' && <button disabled>Running…</button>}
          {phase === 'done' && <button onClick={onClose}>Close</button>}
        </div>
      </div>
    </div>
  )
}
