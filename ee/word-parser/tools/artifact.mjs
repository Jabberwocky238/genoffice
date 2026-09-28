import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const lock = JSON.parse(readFileSync(join(root, 'engine.lock.json'), 'utf8'))
const destination = join(root, 'vendor', lock.artifact)
const verify = (dir, files = lock.files) => {
  for (const [name, expected] of Object.entries(files)) {
    const actual = createHash('sha256')
      .update(readFileSync(join(dir, name)))
      .digest('hex')
    if (actual !== expected) throw new Error(`Artifact hash mismatch: ${name}`)
  }
}

if (process.argv[2] === 'download') {
  if (!lock.runId) throw new Error('engine.lock.json pins a local build; use build <rsWordParser>')
  const staging = mkdtempSync(join(tmpdir(), 'rsword-artifact-'))
  try {
    execFileSync(
      'gh',
      [
        'run',
        'download',
        lock.runId,
        '--repo',
        lock.repository,
        '--name',
        lock.artifact,
        '--dir',
        staging,
      ],
      { stdio: 'inherit' },
    )
    const archive = `${lock.artifact}.tar.gz`
    verify(staging, { [archive]: lock.files[archive] })
    // Extract only after verifying the pinned archive; never run downloaded scripts.
    execFileSync('tar', ['-xzf', join(staging, archive), '-C', staging], { stdio: 'inherit' })
    verify(staging)
    mkdirSync(destination, { recursive: true })
    for (const name of Object.keys(lock.files))
      copyFileSync(join(staging, name), join(destination, name))
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
} else if (process.argv[2] === 'build') {
  // Pin a local build from an rsWordParser checkout: `tools/build-js.sh --locked --features
  // compat-ts` there first (release steps plus the TS-compatible parse/save surface Docs runs on).
  const checkout = process.argv[3]
  if (!checkout)
    throw new Error('Usage: node ee/word-parser/tools/artifact.mjs build <rsWordParser>')
  const git = (...args) =>
    execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8' }).trim()
  if (git('status', '--porcelain', '--untracked-files=no'))
    throw new Error('rsWordParser checkout has uncommitted changes')
  const head = git('rev-parse', 'HEAD')
  const { default: init, version } = await import(
    join(checkout, 'crates/rsword-js/pkg/rsword_js.js')
  )
  await init({
    module_or_path: readFileSync(join(checkout, 'crates/rsword-js/pkg/rsword_js_bg.wasm')),
  })
  const built = JSON.parse(version())
  if (built.protocol !== lock.compatProtocol || !head.startsWith(built.git))
    throw new Error(`pkg is ${built.git}/${built.protocol}; rebuild it at ${head} with compat-ts`)
  const pkg = join(checkout, 'crates/rsword-js/pkg')
  const archive = `${lock.artifact}.tar.gz`
  execFileSync('tar', ['-czf', join(tmpdir(), archive), '-C', pkg, '.'], { stdio: 'inherit' })
  mkdirSync(destination, { recursive: true })
  const files = {}
  for (const name of [
    archive,
    ...readdirSync(pkg)
      .filter((n) => /^rsword_js/.test(n))
      .sort(),
  ]) {
    copyFileSync(name === archive ? join(tmpdir(), name) : join(pkg, name), join(destination, name))
    files[name] = createHash('sha256')
      .update(readFileSync(join(destination, name)))
      .digest('hex')
  }
  const pinned = {
    ...lock,
    commit: head,
    source: 'local',
    runId: null,
    artifactId: null,
    artifactDigest: null,
    features: ['compat-ts'],
    files,
  }
  writeFileSync(join(root, 'engine.lock.json'), `${JSON.stringify(pinned, null, 2)}\n`)
  lock.files = files
} else if (process.argv[2] !== 'check') {
  throw new Error(
    'Usage: node ee/word-parser/tools/artifact.mjs download|check|build <rsWordParser>',
  )
}
verify(destination)
console.log(`rsWordParser ${lock.commit.slice(0, 12)}: all artifact hashes verified`)
