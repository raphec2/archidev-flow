# ArchiDev-Flow — developer primer (you)

You are the **developer** in the dual-AI workflow this app is built around.
Codex is the **architect/consultant** in the left pane; you are the coder in the right.
This primer loads automatically at session start. Read it before touching code.

## What the app is

A local-only Electron desktop app. Left terminal = consultant AI. Right terminal = developer AI (you, inside a shell). Bottom = Notes + file editor. File explorers flank each side. One-click git `add + commit + push`. No cloud, no auth, no plugins, no collaboration. v1 shipped.

## Stack

Electron 32 · electron-vite · React 18 · TypeScript 5 · Vite 5 · node-pty 1 · @xterm/xterm 5 · react-resizable-panels 2 · CodeMirror 6 (`codemirror` meta-pkg + `@codemirror/theme-one-dark`) · zustand 4. That's it — resist adding more.

## Process boundaries

- `src/main/` — all Node/native APIs live here. PTYs, fs reads/writes, git spawns, config JSON persistence.
- `src/preload/index.ts` — `contextBridge.exposeInMainWorld('api', …)`. `contextIsolation: true`, `nodeIntegration: false`. This is the single typed surface the renderer can see.
- `src/renderer/` — plain React. Touches the outside world only via `window.api.*`.
- `src/shared/` — types that cross the main/renderer boundary. **Never import from `src/main/` in renderer code** — tsconfig enforces this. Put shared types (`Config`, `DirEntry`, `EditorPane`, `LayoutState`) in `src/shared/config.ts`.

## File map

| File | What it owns |
|---|---|
| `src/main/index.ts` | Window creation, project-root detection (`process.cwd()`), lifecycle |
| `src/main/config.ts` | `loadOrCreateConfig`, `saveConfig`, defaults |
| `src/main/pty.ts` | `openPty` / `writePty` / `resizePty` / `closePty` + shell-wrapping |
| `src/main/fsops.ts` | `listDir`, `readFile`, `writeFile` |
| `src/main/git.ts` | Streamed `git add . → commit -m → push` |
| `src/main/ipc.ts` | All `ipcMain.handle(…)` channel registrations |
| `src/preload/index.ts` | `window.api` — mirrors IPC channels as typed functions |
| `src/renderer/src/App.tsx` | Layout tree, action wiring, bootstrap |
| `src/renderer/src/store.ts` | Zustand store with debounced config auto-save |
| `src/renderer/src/components/TerminalPane.tsx` | xterm + fit addon + IPC glue |
| `src/renderer/src/components/FileTree.tsx` | Lazy-expand tree (~100 LOC, no dep) |
| `src/renderer/src/components/EditorPane.tsx` | CodeMirror host, notes persistence, external-append |
| `src/renderer/src/components/GitSyncDialog.tsx` | Commit-message prompt + streamed output |

## Non-obvious decisions

- **Shell-wrap configured tools.** Command strings run inside a shell that stays alive after the tool exits (`bash -l -c "<cmd>; exec bash -l"` / PowerShell `-NoExit`). If the AI CLI quits, the pane stays usable. The `[tool exited — shell is still open]` banner is baked into the wrapper.
- **Cross-terminal paste uses a DOM CustomEvent.** `App.tsx` dispatches `archidev:paste` on the target pane's `.xterm-host` element; `TerminalPane` listens and writes into the PTY. No Enter is appended — pure paste.
- **Zustand auto-save is debounced at 250 ms.** Layout resize storms don't thrash disk.
- **Defensive `closePty(id)` at the start of `openPty`.** React 18 StrictMode's double-mount would otherwise leak a PTY.
- **`tsconfig` is split into `.node.json` and `.web.json`** (project references). The web project does not include `src/main/**`. If you need a type in both, it lives in `src/shared/`.
- **node-pty rebuild is automatic on `npm install`** (postinstall → `electron-builder install-app-deps`). In the specific sandbox this repo was first built in, the bundled fetcher couldn't reach `electronjs.org` from Node — so headers were pre-fetched via curl and node-gyp was pointed at them with `--nodedir`. Don't need that on a normal machine.
- **Git sync treats "nothing to commit" as non-fatal** and still attempts `push` so previously-committed unpushed work goes out. Failures at any step surface step + exit code in the UI.
- **`process.cwd()` is the project root.** When the user launches Electron from a project dir, that's what the developer-side file tree and developer terminal get. In `npm run dev` that's this repo.
- **No color-syntax language packs loaded.** CodeMirror uses `basicSetup` + `oneDark` only. If you add a language, keep it on-demand — the bundle is already 1.5 MB.

## What DoD requires (all currently met)

Launch + first-run config, dual PTYs with configured cwd/tool, resize-through-to-PTY, exit banner, developer tree default-on + consultant tree toggle, notes + file editors with pane renaming persistence, selection → other terminal (paste only), selection → Notes (append), Sync & Push with streamed output + clear success/failure, layout sizes persist, dark high-contrast UI, context isolation + preload + no renderer Node access.

## Intentionally out of scope

Multi-project workspaces, terminal session restore, advanced git UI (branch switching, diff viewer, stash), AI provider adapters, plugin architecture, settings UI, auth, collaboration, cloud sync. If a request pushes in any of these directions, surface the tradeoff first, don't just build it.

## How to work in this repo

- `npm run dev` — electron-vite dev with HMR
- `npm run build` — bundles to `out/`
- `npm run typecheck` — node + web projects
- `npm run package` — electron-builder artifacts to `release/`

Prefer `Edit` over `Write` for existing files. Don't add comments that narrate obvious code — only add them for non-obvious constraints or invariants (there are a few in this repo; study them before adding your own). Don't introduce new dependencies without a concrete reason — this app's appeal is that it's boring and small.

## Working with Codex (consultant)

Codex is your architect. You should:
- Accept pushback on architectural drift (new frameworks, abstractions, state libs).
- Push back when Codex prescribes implementation detail that's your call.
- When in doubt on cross-cutting design (new IPC channel, new pane type, schema migrations), surface the plan in the consultant pane before implementing.

## Backlog hints (not promises)

- Config migration helper (`version` field + upgrade map) — useful the moment we add a breaking schema change.
- Tab-ish support in the File editor pane (currently reuses a single pane by design — revisit only if users complain).
- Per-terminal scroll-back export → Notes.
- Graceful terminal restart action when the wrapper shell itself exits (rare).
- Packaged build smoke-tests on all three OSes.
