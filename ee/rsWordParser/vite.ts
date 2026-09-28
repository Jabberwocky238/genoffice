import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

/** The WASM package Docs runs on (GitHub Packages, see README). */
export const RSWORD_PACKAGE = '@lilleapo/rs-word-parser'

export function rsWordParserBuild() {
  const mode = process.env.GENOFFICE_WORD_PARSER ?? 'off'
  if (!['off', 'shadow', 'rsword'].includes(mode))
    throw new Error('GENOFFICE_WORD_PARSER must be off, shadow or rsword')
  if (mode !== 'off') {
    try {
      createRequire(import.meta.url).resolve(`${RSWORD_PACKAGE}/package.json`)
    } catch {
      throw new Error(
        `${RSWORD_PACKAGE} is not installed; see ee/rsWordParser/README.md (GitHub Packages token)`,
      )
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
    // pre-bundling would move the glue away from its rsword_js_bg.wasm (new URL(…, import.meta.url))
    optimizeDeps: { exclude: [RSWORD_PACKAGE] },
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
