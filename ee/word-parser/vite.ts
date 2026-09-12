import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import lock from './engine.lock.json'

export function wordParserBuild() {
  const mode = process.env.GENOFFICE_WORD_PARSER ?? 'off'
  if (mode !== 'off' && mode !== 'shadow')
    throw new Error('GENOFFICE_WORD_PARSER must be off or shadow')
  if (mode === 'shadow') {
    for (const [name, expected] of Object.entries(lock.files)) {
      const path = new URL(`./vendor/rsword-jsbinding/${name}`, import.meta.url)
      let bytes: Buffer
      try {
        bytes = readFileSync(path)
      } catch {
        throw new Error(
          'rsWordParser artifacts are missing. Run npm run ee:word-parser:download first.',
        )
      }
      if (createHash('sha256').update(bytes).digest('hex') !== expected)
        throw new Error(`rsWordParser artifact hash mismatch: ${name}`)
    }
  }
  return {
    alias: {
      '@genoffice/word-parser-extension': fileURLToPath(
        new URL(
          mode === 'shadow'
            ? './src/Diagnostics.tsx'
            : '../../apps/docs/src/renderer/extensions/word-parser.ts',
          import.meta.url,
        ),
      ),
    },
    plugins:
      mode === 'shadow'
        ? [
            {
              name: 'ee-word-parser-csp',
              transformIndexHtml(html: string) {
                return html.replace("script-src 'self';", "script-src 'self' 'wasm-unsafe-eval';")
              },
            },
          ]
        : [],
  }
}
