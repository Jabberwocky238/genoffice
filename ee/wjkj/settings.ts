import { AI_PROVIDERS, type AiSettings } from '@genoffice/ai-provider/browser'

/** Validate the enterprise form using the current upstream provider capabilities. */
export function validateWjkjAiSettings(settings: AiSettings): 'model' | 'baseUrl' | null {
  const config = settings.providers[settings.provider]
  const meta = AI_PROVIDERS.find((provider) => provider.id === settings.provider)
  // CLI providers discover their default model through the authenticated CLI.
  if (!config.model.trim() && !meta?.needsCliPath) return 'model'
  if (meta?.needsBaseUrl && !config.baseUrl?.trim()) return 'baseUrl'
  return null
}
