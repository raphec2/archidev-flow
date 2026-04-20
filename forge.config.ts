import type { ForgeConfig } from '@electron-forge/shared-types'
import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import { MakerZIP } from '@electron-forge/maker-zip'
import { MakerDMG } from '@electron-forge/maker-dmg'
import { MakerDeb } from '@electron-forge/maker-deb'
import { MakerRpm } from '@electron-forge/maker-rpm'
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives'
import { VitePlugin } from '@electron-forge/plugin-vite'

// Packaging config lives here and nowhere else — kept deliberately separate
// from product code (src/**). The `auto-unpack-natives` plugin handles
// node-pty's native binary; rebuild is done by scripts/rebuild-native.js in
// postinstall to avoid @electron/rebuild's Linux hang (see README).
const config: ForgeConfig = {
  packagerConfig: {
    appBundleId: 'dev.archidev.flow',
    name: 'ArchiDev-Flow',
    asar: true,
    // Forge's plugin-vite would otherwise strip everything outside `.vite/`.
    // We keep `node_modules/node-pty` because its native binary (`pty.node`)
    // cannot be bundled by Vite — it must remain on disk for Electron to
    // dlopen. `plugin-auto-unpack-natives` then extracts the `.node` file to
    // `app.asar.unpacked/` so it's loadable at runtime.
    ignore: (file: string | undefined): boolean => {
      if (!file) return false
      const keep =
        file === '/package.json' ||
        file === '/.vite' ||
        file.startsWith('/.vite/') ||
        file === '/node_modules' ||
        file === '/node_modules/node-pty' ||
        file.startsWith('/node_modules/node-pty/')
      return !keep
    },
    // `prune: true` (the default) keeps every entry from `dependencies` in
    // package.json, overriding our ignore above. Disable it — Vite has already
    // bundled every runtime dep into the main/preload/renderer outputs; only
    // node-pty needs to stay on disk for Electron to dlopen its native module.
    prune: false
  },
  // Skip Forge's own rebuild step — scripts/rebuild-native.js has already
  // produced `node-pty` binaries against the correct Electron ABI, and Forge's
  // rebuild path (@electron/rebuild → node-gyp) has been observed to hang or
  // fail on Linux in this environment. Empty `onlyModules` means "rebuild
  // nothing"; `force: false` is a belt-and-suspenders safety.
  rebuildConfig: {
    onlyModules: [],
    force: false
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerDMG({}),
    new MakerDeb({}),
    new MakerRpm({})
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'src/main/main.ts',
          config: 'vite.main.config.ts',
          target: 'main'
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload'
        }
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts'
        }
      ]
    })
  ]
}

export default config
