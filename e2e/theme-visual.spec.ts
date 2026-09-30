import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchShell, closeAndSaveVideo, waitForPageWithUrl, screenshotPath } from './helpers'

async function findShellPage(app: ElectronApplication, timeoutMs = 15_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    for (const candidate of app.windows()) {
      const has = await candidate
        .evaluate(() => Boolean((window as unknown as { aiOffice?: unknown }).aiOffice))
        .catch(() => false)
      if (has) return candidate
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error('No window exposing window.aiOffice')
    await app.waitForEvent('window', { timeout: Math.min(remaining, 1_000) }).catch(() => {})
  }
}

function setTheme(page: Page, theme: 'light' | 'dark' | 'system'): Promise<void> {
  return page.evaluate((t) => {
    const api = (window as unknown as { aiOffice: { setTheme(v: string): Promise<void> } }).aiOffice
    return api.setTheme(t)
  }, theme)
}

/** relative luminance of a computed rgb()/rgba() string, 0 (black) – 255 (white) */
function luminance(rgb: string): number {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb)
  if (!m) throw new Error(`Unparseable color: ${rgb}`)
  return 0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])
}

test.describe('theme visual adoption', () => {
  test('docs renders a dark page in dark theme; View ▸ Dark Mode switches back to white paper', async () => {
    const launched = await launchShell({ onboardingSeen: true, videoDir: 'theme-visual-docs' })
    try {
      const shellPage = await findShellPage(launched.app)
      await shellPage.locator('.quick-card', { hasText: 'AI Docs' }).click()
      const editorPage = await waitForPageWithUrl(launched.app, '://docs/')
      const page = editorPage.locator('.doc-page').first()
      await expect(page).toBeVisible()
      const pageBg = () => page.evaluate((el) => getComputedStyle(el).backgroundColor)
      const pageInk = () => page.evaluate((el) => getComputedStyle(el).color)

      // light theme: white paper, dark ink
      expect(luminance(await pageBg())).toBeGreaterThan(180)
      expect(luminance(await pageInk())).toBeLessThan(60)

      await setTheme(shellPage, 'dark')
      // ribbon and the canvas gutter around pages darken
      await expect
        .poll(async () =>
          luminance(
            await editorPage
              .locator('.ribbon')
              .first()
              .evaluate((el) => getComputedStyle(el).backgroundColor),
          ),
        )
        .toBeLessThan(80)
      expect(
        luminance(
          await editorPage
            .locator('.workspace')
            .first()
            .evaluate((el) => getComputedStyle(el).backgroundColor),
        ),
      ).toBeLessThan(90)
      // Word-style dark page: the paper goes dark and the ink is remapped light
      await expect.poll(async () => luminance(await pageBg())).toBeLessThan(60)
      expect(luminance(await pageInk())).toBeGreaterThan(180)
      await editorPage.screenshot({ path: screenshotPath('theme-docs-dark') })

      // View ▸ Dark Mode is Word's Switch Modes: back to white paper under the dark chrome
      await editorPage.getByRole('button', { name: 'View', exact: true }).click()
      await editorPage.getByRole('button', { name: 'Dark Mode', exact: true }).click()
      await expect.poll(async () => luminance(await pageBg())).toBeGreaterThan(180)
      expect(luminance(await pageInk())).toBeLessThan(60)
      await editorPage.screenshot({ path: screenshotPath('theme-docs-dark-white-page') })
    } finally {
      await closeAndSaveVideo(launched, 'theme-visual-docs')
    }
  })
})
