import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitStatus } from '../shared/config'

const POLL_MS = 4000

// Live branch/status poll. Pauses while the document is hidden so a minimised
// app doesn't keep spawning `git status` processes.
export function useGitStatus(cwd: string | null | undefined): {
  status: GitStatus | null
  refresh: () => Promise<void>
} {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const cwdRef = useRef(cwd)
  cwdRef.current = cwd

  const refresh = useCallback(async (): Promise<void> => {
    const target = cwdRef.current
    if (!target) return
    try {
      const s = await window.api.git.status(target)
      if (cwdRef.current !== target) return
      setStatus(s)
    } catch {
      // leave prior status in place; a later poll may succeed
    }
  }, [])

  useEffect(() => {
    if (!cwd) {
      setStatus(null)
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    function tick(): void {
      if (cancelled) return
      if (document.visibilityState === 'visible') void refresh()
    }

    void refresh()
    timer = setInterval(tick, POLL_MS)

    function onVisibility(): void {
      if (document.visibilityState === 'visible') void refresh()
    }
    function onFocus(): void {
      void refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
    }
  }, [cwd, refresh])

  return { status, refresh }
}
