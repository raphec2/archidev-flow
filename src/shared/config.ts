export type EditorPane = {
  id: string
  name: string
  filePath: string | null
  isNotes: boolean
}

export type LayoutState = {
  mainVertical: [number, number]
  topHorizontal: [number, number]
  bottomHorizontal: number[]
  developerInner: [number, number]
  consultantInner: [number, number]
}

export type DirEntry = {
  name: string
  path: string
  isDir: boolean
  mtimeMs: number
}

export type Config = {
  consultant_dir: string
  consultant_tool: string
  developer_dir: string
  developer_tool: string
  layout: LayoutState
  consultantExplorerVisible: boolean
  developerExplorerVisible: boolean
  editors: EditorPane[]
  notesPath: string
  lastOpenedFiles: string[]
  onboardingComplete: boolean
}

export type DetectedTools = {
  claude?: string
  codex?: string
}

export type PtyExitInfo = { exitCode: number; signal?: number }

// Raw-ish view of `git status --porcelain=v1 -b`. The renderer derives UI
// states (pending, can-push, needs-publish) from this rather than hiding them
// behind IPC surface area.
export type GitFileChange = {
  path: string
  index: string // XY[0] — staged state ('M', 'A', 'D', 'R', 'U', ' ', …)
  worktree: string // XY[1] — worktree state
}

export type GitStatus = {
  isRepo: boolean
  branch: string | null
  detached: boolean
  upstream: string | null
  ahead: number
  behind: number
  tracked: GitFileChange[]
  untracked: string[]
}

export type GitCommitStep = 'add' | 'commit' | 'empty' | 'done'
export type GitCommitResult = {
  ok: boolean
  code: number
  step: GitCommitStep
}

export type GitPushResult = {
  ok: boolean
  code: number
  setUpstream: boolean
  remote: string
  branch: string | null
}
