# ArchiDev-Flow (v1x)

Local desktop workspace for a dual-AI CLI workflow. Terminal host with a
lightweight editor — not an IDE.

- **Left pane**: architect/consultant terminal
- **Right pane**: developer terminal
- **Bottom**: Notes + file editor (CodeMirror 6, explicit save)
- Built-in file explorers and a one-click `git add && commit && push`

Local-only. No cloud, no auth, no telemetry, no plugin system.

## Status

This is the `v1x` rewrite foundation on Electron Forge. The prior
electron-builder + electron-vite tree is recoverable via tag `v1-pre-v1x`
and branch `v1-archive`.

- **Validated today**: Linux x64 (dev run + `electron-forge package`).
- **Not yet validated**: macOS and Windows runtime/packaging on the Forge
  foundation. Expected to work; not exercised.
- **No automated release workflow**: `.github/workflows/release.yml` was
  removed because it targeted electron-builder artifacts. Releases are
  manual (`npm run make`) until a Forge-compatible workflow lands.

See `FOLLOWUPS.md` for short operational items still open.

## Prerequisites

- Node.js 20+
- Native toolchain for `node-pty`:
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `build-essential`, `python3`
  - **Windows**: Python 3 + Visual Studio Build Tools

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
    git.ts                git add/commit/push runner
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
    components/{TerminalPane,EditorPane,FileTree,GitSyncDialog,OnboardingDialog}.tsx
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
