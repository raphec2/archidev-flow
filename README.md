# ArchiDev-Flow

Local desktop workspace for a dual-AI CLI workflow.

- **Left pane**: architect/consultant terminal (point it at Codex/Claude/Aider/etc.)
- **Right pane**: developer terminal (point it at a different tool — or the same one in a different role)
- Bottom: Notes + file editor (CodeMirror 6) with native right-click context menu (Cut/Copy/Paste/Select All)
- Built-in file explorers and a one-click `git add && commit && push` flow

On first launch a short wizard detects `claude` and `codex` on your `PATH`, lets you pick one per pane (or enter a custom command), and lets you pick the consultant's working directory. The developer pane always runs from the directory you launched the app from.

Local-only. No cloud, no auth, no telemetry. Electron's default File/Edit/View menu is hidden — everything lives in-app.

## Prerequisites

- Node.js 20+
- Python / build tools for `node-pty` native module:
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `build-essential`, `python3`
  - **Windows**: `npm config set msvs_version 2022`, Python 3, Visual Studio Build Tools

## Install & run (dev)

```bash
npm install
npm run dev
```

The postinstall hook (`scripts/rebuild-native.js`) rebuilds `node-pty` against the installed Electron's ABI. It invokes `node-gyp` directly — fetching Electron headers to `~/.electron-gyp/<version>/` on first run — instead of `electron-builder install-app-deps`, which transitively uses `@electron/rebuild` and has been observed to hang on Linux.

If `npm install` fails with `ModuleNotFoundError: No module named 'distutils'` under Python 3.12+, delete `node_modules` and `package-lock.json` and reinstall — the `overrides` block in `package.json` pins `node-gyp` to 10.x, which drops the `distutils` import. To skip the native rebuild entirely (e.g. on CI that doesn't run Electron), set `ARCHIDEV_SKIP_NATIVE_REBUILD=1`.

## Build a distributable

```bash
npm run package
```

Artifacts land in `release/`. Linux emits an `.AppImage`, macOS a `.dmg` + `.zip`, Windows an `nsis` installer. Native modules (`node-pty`) are emitted outside the ASAR archive via `asarUnpack` so they load correctly at runtime. `npmRebuild` is disabled in the electron-builder config — the postinstall has already rebuilt `node-pty` against the correct Electron ABI, and electron-builder's own rebuild path hangs in some Linux environments.

## Downloads

Prebuilt installers for Linux (`.AppImage`), macOS (`.dmg`), and Windows (`.exe`) are attached to GitHub Releases. To cut a new release:

```bash
git tag v0.1.1 && git push origin v0.1.1
```

GitHub Actions (`.github/workflows/release.yml`) spins up one runner per platform, runs `npm ci && npm run package`, and drafts a release with the three artifacts attached. Builds are unsigned — macOS users see "unidentified developer" and Windows shows SmartScreen warnings.

## Config

On first launch, `config.json` is written to Electron's `userData` dir. The directory uses the app's `productName` when packaged and the lowercase `name` from `package.json` in `npm run dev`:

| Platform | Packaged | Dev (`npm run dev`) |
|---|---|---|
| macOS | `~/Library/Application Support/ArchiDev-Flow/config.json` | `~/Library/Application Support/archidev-flow/config.json` |
| Linux | `~/.config/ArchiDev-Flow/config.json` | `~/.config/archidev-flow/config.json` |
| Windows | `%APPDATA%/ArchiDev-Flow/config.json` | `%APPDATA%/archidev-flow/config.json` |

Edit with any text editor (or re-run the onboarding wizard by setting `"onboardingComplete": false` and relaunching). Fields:

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

Project root defaults to the directory you launched the app from. In dev, that's this repo.

## Architecture notes

- **Main process** owns all native access: `node-pty`, filesystem reads/writes, `git` spawns, config JSON.
- **Preload** exposes a typed API via `contextBridge`. `contextIsolation: true`, `nodeIntegration: false`.
- **Renderer** is plain React, calls `window.api.*`. No Node access.
- Configured commands are wrapped in the user's shell so the pane stays usable if the AI CLI exits — the shell surfaces an `[tool exited — shell is still open]` banner and an in-UI exit badge.
- `git push` relies on your preconfigured credentials (SSH key / credential helper). Failures surface stderr in the dialog.

## Out of scope for v1

Multi-project management, terminal session restoration, advanced git UI, provider-specific AI logic, plugins, auth, collaboration, cloud sync.
