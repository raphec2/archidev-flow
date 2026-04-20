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
}

export type Config = {
  consultant_dir: string
  consultant_tool: string
  developer_dir: string
  developer_tool: string
  layout: LayoutState
  consultantExplorerVisible: boolean
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

export type GitSyncStep = 'add' | 'commit' | 'push' | 'done'
export type GitSyncResult = {
  ok: boolean
  code: number
  step: GitSyncStep
  output: string
}
