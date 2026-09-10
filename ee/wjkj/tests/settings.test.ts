import { describe, expect, it, vi } from 'vitest'
import { AI_PROVIDERS, defaultAiSettings } from '../../../packages/ai-provider/src/providers'
import { resolveWjkjAiSettings } from '../main'
import { WJKJ_AI_PROVIDERS } from '../providers'
import { createWjkjAiSettingsApi } from '../preload'

describe('WJKJ AI settings', () => {
  it('preserves a custom provider and its configuration on reload', () => {
    const saved = defaultAiSettings()
    saved.provider = 'custom'
    saved.providers.custom = {
      apiKey: 'test-key',
      model: 'private-model',
      baseUrl: 'https://example.com/v1',
    }
    const resolved = resolveWjkjAiSettings(saved)
    expect(resolved.provider).toBe('custom')
    expect(resolved.providers.custom).toEqual(saved.providers.custom)
  })

  it('retains community defaults for an empty settings file', () => {
    expect(resolveWjkjAiSettings({})).toEqual(defaultAiSettings())
  })

  it('adds enterprise model suggestions without changing the core catalog', () => {
    const core = AI_PROVIDERS.find((provider) => provider.id === 'deepseek')!
    const enterprise = WJKJ_AI_PROVIDERS.find((provider) => provider.id === 'deepseek')!
    expect(enterprise.models).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro', ...core.models])
    expect(core.models).not.toContain('deepseek-v4-flash')
    expect(enterprise.models).not.toBe(core.models)
  })

  it('routes settings through the existing shared editor IPC handlers', async () => {
    const settings = defaultAiSettings()
    const invoke = vi.fn().mockResolvedValue(settings)
    const api = createWjkjAiSettingsApi(invoke)
    expect(await api.getAiSettings()).toBe(settings)
    expect(invoke).toHaveBeenLastCalledWith('ai:get-settings')
    await api.setAiSettings(settings)
    expect(invoke).toHaveBeenLastCalledWith('ai:set-settings', settings)
  })
})
