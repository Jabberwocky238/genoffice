import { defaultAiSettings, resolveAiSettings } from '../../packages/ai-provider/src/providers'
import type { AiSettings, LegacyAiSettings } from '../../packages/ai-provider/src/types'

/** Enterprise editors honor the saved provider instead of forcing Genspark. */
export function resolveWjkjAiSettings(stored: Partial<AiSettings> & LegacyAiSettings): AiSettings {
  return resolveAiSettings(stored, defaultAiSettings())
}
