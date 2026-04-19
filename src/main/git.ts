import { spawn } from 'child_process'

function runCmd(cwd: string, args: string[], onOutput: (chunk: string) => void): Promise<number> {
  return new Promise((resolve) => {
    onOutput(`$ git ${args.join(' ')}\n`)
    const p = spawn('git', args, { cwd, env: process.env })
    p.stdout.on('data', (b) => onOutput(b.toString()))
    p.stderr.on('data', (b) => onOutput(b.toString()))
    p.on('error', (err) => {
      onOutput(`\n(failed to spawn git: ${err.message})\n`)
      resolve(1)
    })
    p.on('close', (code) => resolve(code ?? 1))
  })
}

export async function runGitSync(
  cwd: string,
  message: string,
  onOutput: (chunk: string) => void
): Promise<{ ok: boolean; code: number; step: 'add' | 'commit' | 'push' | 'done' }> {
  const addCode = await runCmd(cwd, ['add', '.'], onOutput)
  if (addCode !== 0) return { ok: false, code: addCode, step: 'add' }

  // Skip commit gracefully if there's nothing to commit; still try to push any
  // existing committed-but-unpushed work.
  const statusLines: string[] = []
  await runCmd(cwd, ['status', '--porcelain'], (chunk) => statusLines.push(chunk))
  const hasChanges = statusLines.join('').trim().length > 0

  if (hasChanges) {
    const commitCode = await runCmd(cwd, ['commit', '-m', message], onOutput)
    if (commitCode !== 0) return { ok: false, code: commitCode, step: 'commit' }
  } else {
    onOutput('\n(nothing to commit; attempting push of any unpushed commits)\n')
  }

  const pushCode = await runCmd(cwd, ['push'], onOutput)
  if (pushCode !== 0) return { ok: false, code: pushCode, step: 'push' }

  return { ok: true, code: 0, step: 'done' }
}
