import { spawn } from 'child_process'
import type { DetectedTools } from '../shared/config'

const CANDIDATES = ['claude', 'codex'] as const

function which(cmd: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const finder = process.platform === 'win32' ? 'where' : 'which'
    const child = spawn(finder, [cmd], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf-8')
    })
    child.on('error', () => resolve(undefined))
    child.on('close', (code) => {
      if (code !== 0) return resolve(undefined)
      const first = out.split('\n').map((s) => s.trim()).find(Boolean)
      resolve(first || undefined)
    })
  })
}

export async function detectTools(): Promise<DetectedTools> {
  const entries = await Promise.all(
    CANDIDATES.map(async (name) => [name, await which(name)] as const)
  )
  const out: DetectedTools = {}
  for (const [name, path] of entries) if (path) out[name] = path
  return out
}
