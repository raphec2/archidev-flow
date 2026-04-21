import { spawn } from 'child_process'
import type {
  GitCommitResult,
  GitFileChange,
  GitPushResult,
  GitStatus
} from '../shared/config'

type RunResult = { code: number; stdout: string; stderr: string }

function runCmd(
  cwd: string,
  args: string[],
  onOutput?: (chunk: string) => void
): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    if (onOutput) onOutput(`$ git ${args.join(' ')}\n`)
    let stdout = ''
    let stderr = ''
    const p = spawn('git', args, { cwd, env: process.env })
    p.stdout.on('data', (b) => {
      const s = b.toString()
      stdout += s
      onOutput?.(s)
    })
    p.stderr.on('data', (b) => {
      const s = b.toString()
      stderr += s
      onOutput?.(s)
    })
    p.on('error', (err) => {
      const msg = `\n(failed to spawn git: ${err.message})\n`
      stderr += msg
      onOutput?.(msg)
      resolvePromise({ code: 1, stdout, stderr })
    })
    p.on('close', (code) => resolvePromise({ code: code ?? 1, stdout, stderr }))
  })
}

function emptyStatus(): GitStatus {
  return {
    isRepo: false,
    branch: null,
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    tracked: [],
    untracked: []
  }
}

export async function getGitStatus(cwd: string): Promise<GitStatus> {
  const check = await runCmd(cwd, ['rev-parse', '--is-inside-work-tree'])
  if (check.code !== 0 || check.stdout.trim() !== 'true') return emptyStatus()

  const status = await runCmd(cwd, ['status', '--porcelain=v1', '-b', '-uall'])
  if (status.code !== 0) return emptyStatus()

  const lines = status.stdout.split('\n')
  const headerLine = lines.shift() ?? ''

  let branch: string | null = null
  let detached = false
  let upstream: string | null = null
  let ahead = 0
  let behind = 0

  if (headerLine.startsWith('## ')) {
    let body = headerLine.slice(3).trim()
    if (body.startsWith('HEAD (no branch)')) {
      detached = true
      const sha = await runCmd(cwd, ['rev-parse', '--short', 'HEAD'])
      branch = sha.code === 0 ? sha.stdout.trim() : 'DETACHED'
    } else if (body.startsWith('No commits yet on ')) {
      branch = body.slice('No commits yet on '.length).trim()
    } else {
      const metaMatch = body.match(/\s+\[([^\]]+)\]$/)
      if (metaMatch) {
        const meta = metaMatch[1]
        body = body.slice(0, metaMatch.index).trim()
        const a = meta.match(/ahead (\d+)/)
        const b = meta.match(/behind (\d+)/)
        if (a) ahead = Number(a[1])
        if (b) behind = Number(b[1])
      }
      const sep = body.indexOf('...')
      if (sep >= 0) {
        branch = body.slice(0, sep)
        upstream = body.slice(sep + 3)
      } else {
        branch = body
      }
    }
  }

  const tracked: GitFileChange[] = []
  const untracked: string[] = []
  for (const line of lines) {
    if (!line) continue
    // Each entry: "XY path" where XY is two status chars and the separator is a
    // single space. Renames show "XY orig -> new"; we keep the full suffix.
    const xy = line.slice(0, 2)
    const rest = line.slice(3)
    if (xy === '??') {
      untracked.push(rest)
    } else {
      tracked.push({ path: rest, index: xy[0], worktree: xy[1] })
    }
  }

  return {
    isRepo: true,
    branch,
    detached,
    upstream,
    ahead,
    behind,
    tracked,
    untracked
  }
}

export async function runCommit(
  cwd: string,
  message: string,
  untrackedPaths: string[],
  onOutput: (chunk: string) => void
): Promise<GitCommitResult> {
  // Stage tracked changes only. `git add -u` covers M/D/R/T across the whole
  // working tree (since git 2.0) but deliberately skips untracked files — those
  // must be opted in explicitly below.
  const addTracked = await runCmd(cwd, ['add', '-u'], onOutput)
  if (addTracked.code !== 0) return { ok: false, code: addTracked.code, step: 'add' }

  if (untrackedPaths.length > 0) {
    // `--` guards against any untracked path that happens to look like a flag.
    const addUntracked = await runCmd(cwd, ['add', '--', ...untrackedPaths], onOutput)
    if (addUntracked.code !== 0) return { ok: false, code: addUntracked.code, step: 'add' }
  }

  // Re-check after staging — the user may have opened the dialog and let time
  // pass with an external `git reset`, or the working tree may have been empty
  // to begin with.
  const st = await runCmd(cwd, ['status', '--porcelain'])
  if (st.stdout.trim().length === 0) {
    onOutput('\n(nothing to commit)\n')
    return { ok: false, code: 0, step: 'empty' }
  }

  const commit = await runCmd(cwd, ['commit', '-m', message], onOutput)
  if (commit.code !== 0) return { ok: false, code: commit.code, step: 'commit' }
  return { ok: true, code: 0, step: 'done' }
}

export async function runPush(
  cwd: string,
  opts: { setUpstream?: boolean },
  onOutput: (chunk: string) => void
): Promise<GitPushResult> {
  const remote = 'origin'
  let branch: string | null = null

  if (opts.setUpstream) {
    const br = await runCmd(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
    branch = br.code === 0 ? br.stdout.trim() : null
    if (!branch || branch === 'HEAD') {
      onOutput('\n(cannot publish: detached HEAD or no branch)\n')
      return { ok: false, code: 1, setUpstream: true, remote, branch }
    }
    const r = await runCmd(cwd, ['push', '-u', remote, branch], onOutput)
    return { ok: r.code === 0, code: r.code, setUpstream: true, remote, branch }
  }

  const r = await runCmd(cwd, ['push'], onOutput)
  return { ok: r.code === 0, code: r.code, setUpstream: false, remote, branch }
}
