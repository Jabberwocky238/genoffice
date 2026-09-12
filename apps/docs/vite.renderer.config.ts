import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { wordParserBuild } from '../../ee/word-parser/vite'

const wordParser = wordParserBuild()

// renderer-only dev server (embedded by the shell via DOCS_RENDERER_URL for HMR; no standalone Electron)
export default defineConfig({
  root: 'src/renderer',
  plugins: [react(), ...wordParser.plugins],
  resolve: { alias: wordParser.alias },
  server: {
    port: Number(process.env.DOCS_DEV_PORT) || 5173,
    strictPort: true,
  },
})
