#!/usr/bin/env node
/*
 * Rebuild native deps (node-pty) against the installed Electron ABI.
 *
 * Invokes node-gyp directly instead of going through @electron/rebuild, which
 * has been observed to hang on Linux in node-gyp >=10 environments. Forge's
 * own rebuild path also routes through @electron/rebuild, so we rely on this
 * postinstall having already produced the correct binaries.
 *
 * Skipped when CI disables native rebuilds or when Electron isn't installed.
 */
const { spawnSync } = require('node:child_process')
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const https = require('node:https')
const os = require('node:os')

if (process.env.ARCHIDEV_SKIP_NATIVE_REBUILD === '1') {
  console.log('[rebuild-native] skipped via ARCHIDEV_SKIP_NATIVE_REBUILD')
  process.exit(0)
}

const projectRoot = resolve(__dirname, '..')
const electronPkgPath = join(projectRoot, 'node_modules', 'electron', 'package.json')
if (!existsSync(electronPkgPath)) {
  console.log('[rebuild-native] electron not installed — skipping')
  process.exit(0)
}
const electronVersion = JSON.parse(readFileSync(electronPkgPath, 'utf-8')).version
const arch = process.env.npm_config_arch || process.arch
const nodedir = join(os.homedir(), '.electron-gyp', electronVersion)

function ensureHeaders() {
  const markerFile = join(nodedir, 'installVersion')
  const includeDir = join(nodedir, 'include', 'node')
  if (existsSync(markerFile) && existsSync(includeDir)) return Promise.resolve()
  mkdirSync(nodedir, { recursive: true })
  const url = `https://electronjs.org/headers/v${electronVersion}/node-v${electronVersion}-headers.tar.gz`
  console.log(`[rebuild-native] fetching headers: ${url}`)
  const tarballPath = join(nodedir, 'headers.tar.gz')
  return downloadTo(url, tarballPath).then(() => {
    const extract = spawnSync(
      'tar',
      ['-xzf', tarballPath, '--strip-components=1', '-C', nodedir],
      { stdio: 'inherit' }
    )
    if (extract.status !== 0) throw new Error('[rebuild-native] failed to extract headers')
    writeFileSync(markerFile, '9\n')
  })
}

function downloadTo(url, dest) {
  return new Promise((resolvePromise, rejectPromise) => {
    const fs = require('node:fs')
    const file = fs.createWriteStream(dest)
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          downloadTo(res.headers.location, dest).then(resolvePromise, rejectPromise)
          return
        }
        if (res.statusCode !== 200) {
          rejectPromise(new Error(`download failed: ${res.statusCode}`))
          return
        }
        res.pipe(file)
        file.on('finish', () => file.close(() => resolvePromise()))
      })
      .on('error', rejectPromise)
  })
}

function rebuild(moduleName) {
  const moduleDir = join(projectRoot, 'node_modules', moduleName)
  if (!existsSync(moduleDir)) {
    console.log(`[rebuild-native] ${moduleName} not found — skipping`)
    return
  }
  const nodeGyp = join(
    projectRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'node-gyp.cmd' : 'node-gyp'
  )
  if (!existsSync(nodeGyp)) throw new Error('[rebuild-native] node-gyp not installed')
  console.log(`[rebuild-native] rebuilding ${moduleName} for electron@${electronVersion} (${arch})`)
  const result = spawnSync(
    nodeGyp,
    [
      'rebuild',
      `--target=${electronVersion}`,
      `--arch=${arch}`,
      '--dist-url=https://electronjs.org/headers',
      `--nodedir=${nodedir}`
    ],
    { cwd: moduleDir, stdio: 'inherit', env: process.env }
  )
  if (result.status !== 0) {
    throw new Error(`[rebuild-native] ${moduleName} rebuild exited ${result.status}`)
  }
}

;(async () => {
  try {
    await ensureHeaders()
    rebuild('node-pty')
    console.log('[rebuild-native] done')
  } catch (e) {
    console.error(e.message || e)
    process.exit(1)
  }
})()
