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

async function ensureHeaders() {
  const markerFile = join(nodedir, 'installVersion')
  const includeDir = join(nodedir, 'include', 'node')
  const needHeaders = !(existsSync(markerFile) && existsSync(includeDir))

  if (needHeaders) {
    mkdirSync(nodedir, { recursive: true })
    const url = `https://electronjs.org/headers/v${electronVersion}/node-v${electronVersion}-headers.tar.gz`
    console.log(`[rebuild-native] fetching headers: ${url}`)
    const tarballPath = join(nodedir, 'headers.tar.gz')
    await downloadTo(url, tarballPath)
    const extract = spawnSync(
      'tar',
      ['-xzf', tarballPath, '--strip-components=1', '-C', nodedir],
      { stdio: 'inherit' }
    )
    if (extract.status !== 0) throw new Error('[rebuild-native] failed to extract headers')
    writeFileSync(markerFile, '9\n')
  }

  // Windows links against node.lib (not in the headers tarball); Electron's common.gypi expects it at $NODEDIR/Release/node.lib.
  if (process.platform === 'win32') {
    const libDir = join(nodedir, 'Release')
    const libPath = join(libDir, 'node.lib')
    if (!existsSync(libPath)) {
      mkdirSync(libDir, { recursive: true })
      const libUrl = `https://electronjs.org/headers/v${electronVersion}/win-${arch}/node.lib`
      console.log(`[rebuild-native] fetching node.lib: ${libUrl}`)
      await downloadTo(libUrl, libPath)
    }
  }
}

// Follow redirects before touching the filesystem. Opening the destination
// WriteStream before a redirect on Windows leaves a dangling handle on the
// file the recursive call is also writing to, which has been observed to
// produce `LNK1104: cannot open file ... node.lib` during node-gyp builds.
function httpGet(url, maxRedirects = 5) {
  return new Promise((resolvePromise, rejectPromise) => {
    const follow = (currentUrl, remaining) => {
      https
        .get(currentUrl, (res) => {
          const status = res.statusCode || 0
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume()
            if (remaining <= 0) {
              rejectPromise(new Error(`too many redirects for ${url}`))
              return
            }
            const nextUrl = new URL(res.headers.location, currentUrl).toString()
            follow(nextUrl, remaining - 1)
            return
          }
          if (status !== 200) {
            res.resume()
            rejectPromise(new Error(`download failed: ${status} for ${currentUrl}`))
            return
          }
          resolvePromise(res)
        })
        .on('error', rejectPromise)
    }
    follow(url, maxRedirects)
  })
}

function downloadTo(url, dest) {
  const fs = require('node:fs')
  return httpGet(url).then(
    (res) =>
      new Promise((resolvePromise, rejectPromise) => {
        // Download to a sibling temp path and rename into place so MSBuild
        // (or any later consumer) never observes a partial or locked file.
        const tmpDest = `${dest}.download`
        try {
          fs.unlinkSync(tmpDest)
        } catch {}
        const file = fs.createWriteStream(tmpDest)
        let settled = false
        const fail = (err) => {
          if (settled) return
          settled = true
          file.destroy()
          try {
            fs.unlinkSync(tmpDest)
          } catch {}
          rejectPromise(err)
        }
        file.on('error', fail)
        res.on('error', fail)
        res.pipe(file)
        file.on('finish', () => {
          file.close((closeErr) => {
            if (closeErr) {
              fail(closeErr)
              return
            }
            try {
              fs.renameSync(tmpDest, dest)
            } catch (renameErr) {
              fail(renameErr)
              return
            }
            if (!settled) {
              settled = true
              resolvePromise()
            }
          })
        })
      })
  )
}

function rebuild(moduleName) {
  const moduleDir = join(projectRoot, 'node_modules', moduleName)
  if (!existsSync(moduleDir)) {
    console.log(`[rebuild-native] ${moduleName} not found — skipping`)
    return
  }
  // Spawn node-gyp's JS entrypoint with the current node binary. The `.bin`
  // shim (`node-gyp.cmd` on Windows) can't be launched by spawnSync under
  // Node's CVE-2024-27980 hardening without `shell: true`, which brings argv
  // injection risk. Going through the JS entrypoint behaves the same on all
  // platforms and avoids shell quoting entirely.
  let nodeGypJs
  try {
    nodeGypJs = require.resolve('node-gyp/bin/node-gyp.js')
  } catch {
    throw new Error('[rebuild-native] node-gyp not installed')
  }
  console.log(`[rebuild-native] rebuilding ${moduleName} for electron@${electronVersion} (${arch})`)
  const result = spawnSync(
    process.execPath,
    [
      nodeGypJs,
      'rebuild',
      `--target=${electronVersion}`,
      `--arch=${arch}`,
      '--dist-url=https://electronjs.org/headers',
      `--nodedir=${nodedir}`
    ],
    { cwd: moduleDir, stdio: 'inherit', env: process.env }
  )
  if (result.error) {
    throw new Error(
      `[rebuild-native] ${moduleName} rebuild failed to launch: ${result.error.message}`
    )
  }
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
