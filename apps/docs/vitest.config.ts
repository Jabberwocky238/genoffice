import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// resolve sibling source packages by path (not via node_modules), so a git
// worktree whose node_modules is linked to another checkout still tests
// against this checkout's edits (same convention as packages/pdf2docx)
const local = (rel: string) => fileURLToPath(new URL(rel, import.meta.url))
// GENOFFICE_WORD_PARSER=rsword runs the suite on rsWordParser's parse/save (ee/word-parser)
const rsword = process.env.GENOFFICE_WORD_PARSER === 'rsword'

export default defineConfig({
  resolve: {
    alias: {
      '@genoffice/word-parser-extension': rsword
        ? local('../../ee/word-parser/src/extension.ts')
        : local('./src/renderer/extensions/word-parser.ts'),
      '@genoffice/docx-engine/lazy-media': local('../../packages/docx-engine/src/lazy-media.ts'),
      '@genoffice/docx-engine': rsword
        ? local('../../ee/word-parser/src/engine-shim.ts')
        : local('../../packages/docx-engine/src/index.ts'),
      '@genoffice/font-metrics': local('../../packages/font-metrics/src/index.ts'),
      // subpath before the bare name: string aliases are prefix replacements
      '@genoffice/electron-utils/headless-export': local(
        '../../packages/electron-utils/src/headless-export.ts',
      ),
      '@genoffice/electron-utils/atomic-write': local(
        '../../packages/electron-utils/src/atomic-write.ts',
      ),
      '@genoffice/electron-utils': local('../../packages/electron-utils/src/index.ts'),
      '@genoffice/ai-provider/browser': local('../../packages/ai-provider/src/browser.ts'),
      '@genoffice/ai-provider': local('../../packages/ai-provider/src/index.ts'),
      '@genoffice/i18n': local('../../packages/i18n/src/index.ts'),
      '@genoffice/ui': local('../../packages/ui/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'jsdom',
    testTimeout: 20000,
    setupFiles: rsword ? [local('../../ee/word-parser/tests/setup-rsword.ts')] : [],
  },
})
