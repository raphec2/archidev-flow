# ArchiDev-Flow (v1x)

Local desktop workspace for a dual-AI CLI workflow. Terminal host with a
lightweight editor — not an IDE.

- **Left pane**: architect/consultant terminal
- **Right pane**: developer terminal
- **Bottom**: Notes + file editor (CodeMirror 6, explicit save)
- Built-in file explorers and split `Commit` / `Push` git actions with a
  live branch chip in the header

Local-only. No cloud, no auth, no telemetry, no plugin system.

## Status

This is the `v1x` rewrite foundation on Electron Forge. The prior
electron-builder + electron-vite tree is recoverable via tag `v1-pre-v1x`
and branch `v1-archive`.

- **Validated today**: Linux x64 (dev run + `electron-forge package`).
- **Not yet validated**: macOS and Windows runtime/packaging on the Forge
  foundation. Expected to work; not exercised.
- **CI**: `.github/workflows/ci.yml` runs `npm ci` + `npm run typecheck` +
  `npx electron-forge package` on every push to `main` and every PR. The
  linux lane is required; macos and windows lanes are marked exploratory
  (`continue-on-error: true`) so their failures are visible but do not
  fail the overall run.
- **No automated release workflow**: the old `release.yml` targeted
  electron-builder artifacts and was removed. Releases stay manual
  (`npm run make`) until a Forge-compatible workflow lands — see
  `FOLLOWUPS.md`.

See `FOLLOWUPS.md` for short operational items still open.

## Prerequisites

- Node.js 20+
- Native toolchain for `node-pty`:
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `build-essential`, `python3`
  - **Windows**: Python 3 + Visual Studio Build Tools

## Launching against a project

The app is workspace-scoped: every workspace (per-workspace config, notes,
default pane cwds) is keyed from the project root the app was launched
against. The launch root is resolved in `src/main/main.ts` with this order:

1. First positional CLI argument, if it resolves to an existing directory.
2. `process.cwd()`, if that is a real, non-filesystem-root directory.
3. `os.homedir()` as a neutral fallback.

Expected invocations:

```bash
# From a project shell (dev or installed CLI entry):
archidev-flow .                  # explicit — preserves prior cwd-driven behaviour
archidev-flow /path/to/project   # explicit positional argument
cd /path/to/project && archidev-flow
```

Desktop-launcher starts (macOS Finder/Dock, Linux `.desktop`, Windows
Start Menu / shortcut) supply no argument and no meaningful cwd. The app
opens against the home directory in that case; pick the consultant /
developer directories through onboarding. If an argument is supplied but
is not an existing directory, the app shows a native error dialog and
opens against the fallback instead of using the bad path as a workspace
key.

## Dev

```bash
npm install
npm start
```

`npm start` runs `electron-forge start`, which loads the Vite dev server for
the renderer and the main/preload bundles. The `postinstall` hook
(`scripts/rebuild-native.js`) rebuilds `node-pty` against the installed
Electron ABI by invoking `node-gyp` directly — avoiding `@electron/rebuild`,
which has been observed to hang on Linux. Set
`ARCHIDEV_SKIP_NATIVE_REBUILD=1` to skip on CI.

## Packaging

```bash
npm run make
```

Artifacts land in `out/`. Forge uses its own makers: Squirrel for Windows,
DMG + ZIP for macOS, deb + rpm for Linux. `node-pty` is unpacked from the
asar archive by `@electron-forge/plugin-auto-unpack-natives`.

Builds are unsigned — macOS shows "unidentified developer", Windows triggers
SmartScreen warnings.

## Architecture

```
src/
  main/
    main.ts               app lifecycle, createWindow
    ipc.ts                IPC wiring
    detect.ts             claude/codex on PATH
    git.ts                git status + commit + push runners (separate IPC)
    session/
      backend.ts          SessionBackend interface (seam)
      local-pty.ts        node-pty implementation
    workspace/
      store.ts            WorkspaceStore interface (seam)
      local-fs.ts         per-workspace userData impl + legacy migration
    context/
      source.ts           ContextSource interface (seam)
      local-fs.ts         dir listing + file read/write
  preload/
    preload.ts            contextBridge
    api.d.ts              window.api ambient type
  renderer/
    main.tsx, App.tsx, store.ts, styles.css
    components/{TerminalPane,EditorPane,FileTree,CommitDialog,PushDialog,OnboardingDialog}.tsx
  shared/
    config.ts, ipc.ts
```

Boundaries are strict: the renderer only talks to main via `window.api.*`
(`contextIsolation: true`, `nodeIntegration: false`). Native access
(node-pty, filesystem, git) lives only in main.

### Three abstraction seams

These exist to keep future additions (SSH sessions, alternate persistence,
richer context sources) from forcing a rewrite of the UI contract. Only
local implementations exist today and that is the end of the scope; no
future features are implemented.

- `SessionBackend` → `LocalPtyBackend`
- `WorkspaceStore` → `LocalFsWorkspaceStore`
- `ContextSource` → `LocalFsContextSource`

## Workspace persistence

State lives under Electron `userData/workspaces/<sha256[:16]>/`, keyed from
the project root the app was launched in. A sibling `meta.json` records the
human-readable absolute path; a default `notes.md` is created once. A legacy
`userData/config.json` is consumed once as a seed for the first workspace
post-upgrade and then archived to `config.legacy.json`.

## Save model

Editor files are explicit-save only. Dirty state is shown per pane with an
orange dot; `Ctrl/Cmd+S` or the Save button writes to disk. Unsaved changes
are guarded on: pane replacement (opening a new file), consultant-explorer
close (destroys `consultantFile` pane), and window unload / app quit.

Layout and workspace metadata autosave debounced — that is low-risk and
matches v1 behaviour.

## Git workflow

Git actions are split into `Commit` and `Push`:

- The header carries a live branch chip showing the current branch, upstream
  (if any), ahead/behind counts, and pending-change indicator. It polls while
  the window is visible and refreshes on focus.
- `Commit` opens a review dialog that lists tracked changes (included by
  default) and untracked files (opt-in per file). On confirm it stages tracked
  changes with `git add -u` and any selected untracked paths with
  `git add -- <paths>`, then runs `git commit -m <msg>`. The message is drafted
  from the current commit scope (`update: a.ts, b.ts`) and stays editable. No
  auto-push.
- `Push` opens a dialog that spells out the destination (`origin/<branch>`).
  On a branch without an upstream the action switches to `Publish`, running
  `git push -u origin <branch>`.
- Commits and pushes never happen implicitly; both require explicit
  confirmation in their dialog.

## Session lifecycle

PTYs are owned by the main process. Teardown happens exclusively in
`window-all-closed` — never in `before-quit`, because `before-quit` fires
before the renderer's `beforeunload` can veto the quit for unsaved editor
changes. Tearing down PTYs there left terminal panes dead after a cancelled
quit in v1; v1x does not carry that bug forward.

## Config schema

```json
{
  "consultant_dir": "/abs/path",
  "consultant_tool": "codex",
  "developer_dir": "/abs/path",
  "developer_tool": "claude",
  "layout": { ... persisted pane sizes ... },
  "consultantExplorerVisible": false,
  "editors": [{ "id": "notes", "name": "Notes", "filePath": null, "isNotes": true }, ...],
  "notesPath": "/abs/path/to/notes.md",
  "lastOpenedFiles": [],
  "onboardingComplete": true
}
```

## Out of scope

Multi-project management, SSH terminals, remote editing, cloud sync,
plugins, settings UI, auth, collaboration.
