import { spawnSync } from 'node:child_process'
const command = process.argv[2] ?? 'dev'
if (!['dev', 'dev:renderer', 'build'].includes(command))
  throw new Error('Expected dev, dev:renderer or build')
const result = spawnSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['run', command, '-w', '@genoffice/docs'],
  {
    stdio: 'inherit',
    env: { ...process.env, GENOFFICE_WORD_PARSER: 'shadow' },
    shell: process.platform === 'win32',
  },
)
if (result.error) throw result.error
process.exit(result.status ?? 1)
