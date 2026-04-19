# ArchiDev-Flow

Local desktop workspace for a dual-AI CLI workflow.

- **Left pane**: architect/consultant terminal (default: your shell — point it at Codex/Aider/etc. via config)
- **Right pane**: developer terminal (default: your shell — point it at Claude/etc.)
- Bottom: Notes + file editor (CodeMirror 6)
- Built-in file explorers and a one-click `git add && commit && push` flow

Local-only. No cloud, no auth, no telemetry.

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

The first run rebuilds `node-pty` for Electron's Node ABI via `electron-builder install-app-deps` (postinstall hook).

## Build a distributable

```bash
npm run package
```

Artifacts land in `release/`.

## Config

On first launch, `config.json` is written to Electron's `userData` dir:

- macOS: `~/Library/Application Support/ArchiDev-Flow/config.json`
- Linux: `~/.config/ArchiDev-Flow/config.json`
- Windows: `%APPDATA%/ArchiDev-Flow/config.json`

Edit it with any text editor. Fields:

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
  "lastOpenedFiles": []
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
