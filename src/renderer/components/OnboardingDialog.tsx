import { useEffect, useState } from 'react'
import type { DetectedTools } from '../../shared/config'

type ToolChoice = 'claude' | 'codex' | 'custom'

type Props = {
  projectRoot: string
  initialConsultantDir: string
  onComplete: (result: {
    consultant_tool: string
    developer_tool: string
    consultant_dir: string
  }) => void
}

function resolveToolCommand(
  choice: ToolChoice,
  custom: string,
  detected: DetectedTools
): string {
  if (choice === 'claude') return detected.claude || 'claude'
  if (choice === 'codex') return detected.codex || 'codex'
  return custom.trim()
}

function defaultChoice(detected: DetectedTools): ToolChoice {
  if (detected.claude) return 'claude'
  if (detected.codex) return 'codex'
  return 'custom'
}

export function OnboardingDialog({
  projectRoot,
  initialConsultantDir,
  onComplete
}: Props): JSX.Element {
  const [detected, setDetected] = useState<DetectedTools>({})
  const [loading, setLoading] = useState(true)
  const [consultantChoice, setConsultantChoice] = useState<ToolChoice>('custom')
  const [developerChoice, setDeveloperChoice] = useState<ToolChoice>('custom')
  const [consultantCustom, setConsultantCustom] = useState('')
  const [developerCustom, setDeveloperCustom] = useState('')
  const [consultantDir, setConsultantDir] = useState(initialConsultantDir)

  useEffect(() => {
    let cancelled = false
    window.api.tool.detect().then((d) => {
      if (cancelled) return
      setDetected(d)
      const initial = defaultChoice(d)
      setConsultantChoice(initial)
      setDeveloperChoice(initial)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function browseConsultantDir(): Promise<void> {
    const picked = await window.api.dialog.pickDirectory()
    if (picked) setConsultantDir(picked)
  }

  function finish(): void {
    const consultant_tool = resolveToolCommand(consultantChoice, consultantCustom, detected)
    const developer_tool = resolveToolCommand(developerChoice, developerCustom, detected)
    if (!consultant_tool || !developer_tool) return
    onComplete({
      consultant_tool,
      developer_tool,
      consultant_dir: consultantDir.trim() || projectRoot
    })
  }

  const canFinish =
    (consultantChoice !== 'custom' || consultantCustom.trim().length > 0) &&
    (developerChoice !== 'custom' || developerCustom.trim().length > 0) &&
    consultantDir.trim().length > 0

  return (
    <div className="modal-backdrop">
      <div className="modal onboarding">
        <div className="modal-header">Welcome to ArchiDev-Flow</div>
        <div className="modal-body">
          <p style={{ margin: '0 0 6px 0', color: 'var(--text-1)' }}>
            Pick the AI CLI for each terminal. You can change these later by editing{' '}
            <code>config.json</code>.
          </p>

          {loading ? (
            <div style={{ color: 'var(--text-2)' }}>Detecting installed CLIs…</div>
          ) : (
            <>
              <ToolSection
                title="Consultant (left)"
                choice={consultantChoice}
                setChoice={setConsultantChoice}
                custom={consultantCustom}
                setCustom={setConsultantCustom}
                detected={detected}
              />

              <div>
                <label
                  style={{
                    display: 'block',
                    color: 'var(--text-2)',
                    fontSize: 11,
                    margin: '4px 0 2px 0'
                  }}
                >
                  Consultant working directory
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    style={{ flex: 1, fontFamily: 'var(--font-mono)' }}
                    value={consultantDir}
                    onChange={(e) => setConsultantDir(e.target.value)}
                  />
                  <button onClick={browseConsultantDir}>Browse…</button>
                </div>
              </div>

              <div style={{ height: 6 }} />

              <ToolSection
                title="Developer (right)"
                choice={developerChoice}
                setChoice={setDeveloperChoice}
                custom={developerCustom}
                setCustom={setDeveloperCustom}
                detected={detected}
              />

              <div style={{ color: 'var(--text-2)', fontSize: 11 }}>
                Developer runs from <code>{projectRoot}</code> (the directory you launched from).
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button disabled={!canFinish || loading} onClick={finish}>
            Get started
          </button>
        </div>
      </div>
    </div>
  )
}

function ToolSection({
  title,
  choice,
  setChoice,
  custom,
  setCustom,
  detected
}: {
  title: string
  choice: ToolChoice
  setChoice: (c: ToolChoice) => void
  custom: string
  setCustom: (c: string) => void
  detected: DetectedTools
}): JSX.Element {
  return (
    <div>
      <div style={{ color: 'var(--text-1)', fontWeight: 600, marginBottom: 4 }}>{title}</div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <ToolRadio
          label="Claude Code"
          value="claude"
          current={choice}
          onChange={setChoice}
          detectedPath={detected.claude}
        />
        <ToolRadio
          label="Codex"
          value="codex"
          current={choice}
          onChange={setChoice}
          detectedPath={detected.codex}
        />
        <ToolRadio label="Custom" value="custom" current={choice} onChange={setChoice} />
      </div>
      {choice === 'custom' && (
        <input
          style={{ marginTop: 6, width: '100%', fontFamily: 'var(--font-mono)' }}
          placeholder="e.g. aider --model sonnet"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
        />
      )}
    </div>
  )
}

function ToolRadio({
  label,
  value,
  current,
  onChange,
  detectedPath
}: {
  label: string
  value: ToolChoice
  current: ToolChoice
  onChange: (c: ToolChoice) => void
  detectedPath?: string
}): JSX.Element {
  const disabled = (value === 'claude' || value === 'codex') && !detectedPath
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1
      }}
      title={detectedPath || (disabled ? 'Not found in PATH' : '')}
    >
      <input
        type="radio"
        checked={current === value}
        disabled={disabled}
        onChange={() => onChange(value)}
      />
      <span>{label}</span>
      {detectedPath && (
        <span style={{ color: 'var(--success)', fontSize: 10 }} title={detectedPath}>
          ✓
        </span>
      )}
    </label>
  )
}
