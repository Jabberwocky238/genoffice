import type { AiSettings } from '../../packages/ai-provider/src/types'

export interface WjkjAiSettingsApi {
  getAiSettings(): Promise<AiSettings>
  setAiSettings(settings: AiSettings): Promise<void>
}
