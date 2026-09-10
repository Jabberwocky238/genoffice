import { describe, expect, it } from 'vitest'
import { defaultAiSettings } from '../../../packages/ai-provider/src/providers'
import { validateWjkjAiSettings } from '../settings'

describe('WJKJ custom API form', () => {
  it('requires a model for custom endpoints', () => {
    const settings = defaultAiSettings()
    settings.provider = 'custom'
    settings.providers.custom = { apiKey: '', model: ' ', baseUrl: 'https://example.com/v1' }
    expect(validateWjkjAiSettings(settings)).toBe('model')
  })

  it('requires a nonempty URL for custom endpoints', () => {
    const settings = defaultAiSettings()
    settings.provider = 'custom'
    settings.providers.custom = { apiKey: '', model: 'private-model', baseUrl: ' ' }
    expect(validateWjkjAiSettings(settings)).toBe('baseUrl')
  })

  it('accepts a local endpoint without a key and preserves additional upstream settings', () => {
    const settings = defaultAiSettings()
    settings.provider = 'custom'
    settings.providers.custom = {
      apiKey: '',
      model: 'local-model',
      baseUrl: 'http://localhost:8000/v1',
    }
    const before = structuredClone(settings)
    expect(validateWjkjAiSettings(settings)).toBeNull()
    expect(settings).toEqual(before)
  })

  it('allows a CLI provider to discover its default model', () => {
    const settings = defaultAiSettings()
    settings.provider = 'codex'
    settings.providers.codex.model = ''
    expect(validateWjkjAiSettings(settings)).toBeNull()
  })
})
