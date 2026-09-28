import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import lock from './engine.lock.json'

export function rsWordParserBuild() {
  const mode = process.env.GENOFFICE_WORD_PARSER ?? 'off'
  if (!['off', 'shadow', 'rsword'].includes(mode))
    throw new Error('GENOFFICE_WORD_PARSER must be off, shadow or rsword')
  if (mode !== 'off') {
    for (const [name, expected] of Object.entries(lock.files)) {
      const path = new URL(`./vendor/rsword-jsbinding/${name}`, import.meta.url)
      let bytes: Buffer
      try {
        bytes = readFileSync(path)
      } catch {
        throw new Error(
          'rsWordParser artifacts are missing. Run npm run ee:rsWordParser:build first.',
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
          {
            off: '../../apps/docs/src/renderer/extensions/word-parser.ts',
            shadow: './src/shadow.ts',
            rsword: './index.ts',
          }[mode]!,
          import.meta.url,
        ),
      ),
    },
    plugins:
      mode !== 'off'
        ? [
            {
              name: 'ee-rsword-csp',
              transformIndexHtml(html: string) {
                return html.replace("script-src 'self';", "script-src 'self' 'wasm-unsafe-eval';")
              },
            },
          ]
        : [],
  }
}
