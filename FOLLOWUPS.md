# Follow-ups

Short operational items left open from the `v1x` rewrite promotion. Delete
an entry once it is resolved; keep this file focused on things that would
bite a future reader.

- **Native rebuild / package guard.** `scripts/rebuild-native.js`
  (postinstall) is the only path that rebuilds `node-pty` against the
  correct Electron ABI — Forge's own rebuild is disabled
  (`rebuildConfig.onlyModules: []`) because `@electron/rebuild` hangs on
  Linux in this environment. If someone runs
  `ARCHIDEV_SKIP_NATIVE_REBUILD=1 npm install` and then `npm run make`, the
  packaged `pty.node` may not match Electron's ABI and terminals will fail
  at runtime. Add a packaging-time sanity check (e.g. verify `pty.node`
  exists under `node_modules/node-pty/build/Release/` and fail fast in
  `forge.config.ts` `prePackage` if it is missing or stale).

- **Dirty-close UX.** `beforeunload` currently uses the browser's default
  "unsaved changes" prompt for Cmd+Q / window close. Consider a friendlier
  in-app modal that names the dirty pane(s) and offers Save / Discard /
  Cancel, matching the in-app prompt already used for pane replacement and
  consultant-explorer close.
