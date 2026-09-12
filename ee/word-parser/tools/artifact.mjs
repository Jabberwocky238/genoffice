import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
} else if (process.argv[2] !== 'check') {
  throw new Error('Usage: node ee/word-parser/tools/artifact.mjs download|check')
}
verify(destination)
console.log(`rsWordParser ${lock.commit.slice(0, 12)}: all artifact hashes verified`)
