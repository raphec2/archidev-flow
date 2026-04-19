import { create } from 'zustand'
import type { Config, EditorPane, LayoutState } from '../../shared/config'

type Store = {
  config: Config | null
  projectRoot: string
  consultantSelection: string
  developerSelection: string
  setConfig: (cfg: Config) => void
  patchConfig: (partial: Partial<Config>) => void
  setLayout: (partial: Partial<LayoutState>) => void
  setConsultantExplorerVisible: (v: boolean) => void
  setEditorPane: (id: string, patch: Partial<EditorPane>) => void
  addEditorPane: (pane: EditorPane) => void
  removeEditorPane: (id: string) => void
  setProjectRoot: (root: string) => void
  setConsultantSelection: (s: string) => void
  setDeveloperSelection: (s: string) => void
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave(cfg: Config): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    window.api.config.save(cfg).catch(() => {
      /* best-effort persistence */
    })
  }, 250)
}

export const useStore = create<Store>((set, get) => ({
  config: null,
  projectRoot: '',
  consultantSelection: '',
  developerSelection: '',
  setConfig: (cfg) => set({ config: cfg }),
  patchConfig: (partial) => {
    const cur = get().config
    if (!cur) return
    const next = { ...cur, ...partial }
    set({ config: next })
    scheduleSave(next)
  },
  setLayout: (partial) => {
    const cur = get().config
    if (!cur) return
    const next = { ...cur, layout: { ...cur.layout, ...partial } }
    set({ config: next })
    scheduleSave(next)
  },
  setConsultantExplorerVisible: (v) => {
    const cur = get().config
    if (!cur) return
    const editors = [...cur.editors]
    const hasThird = editors.some((e) => e.id === 'consultantFile')
    if (v && !hasThird) {
      editors.unshift({ id: 'consultantFile', name: 'Consultant File', filePath: null, isNotes: false })
    } else if (!v && hasThird) {
      const idx = editors.findIndex((e) => e.id === 'consultantFile')
      if (idx >= 0) editors.splice(idx, 1)
    }
    const next = { ...cur, consultantExplorerVisible: v, editors }
    set({ config: next })
    scheduleSave(next)
  },
  setEditorPane: (id, patch) => {
    const cur = get().config
    if (!cur) return
    const editors = cur.editors.map((e) => (e.id === id ? { ...e, ...patch } : e))
    const next = { ...cur, editors }
    set({ config: next })
    scheduleSave(next)
  },
  addEditorPane: (pane) => {
    const cur = get().config
    if (!cur) return
    const next = { ...cur, editors: [...cur.editors, pane] }
    set({ config: next })
    scheduleSave(next)
  },
  removeEditorPane: (id) => {
    const cur = get().config
    if (!cur) return
    const next = { ...cur, editors: cur.editors.filter((e) => e.id !== id) }
    set({ config: next })
    scheduleSave(next)
  },
  setProjectRoot: (root) => set({ projectRoot: root }),
  setConsultantSelection: (s) => set({ consultantSelection: s }),
  setDeveloperSelection: (s) => set({ developerSelection: s })
}))
