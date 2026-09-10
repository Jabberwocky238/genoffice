import type { AiSettings } from '../../packages/ai-provider/src/types'

export interface WjkjAiSettingsApi {
  getAiSettings(): Promise<AiSettings>
  setAiSettings(settings: AiSettings): Promise<void>
}

export const WJKJ_AI_CHANNELS = {
  getAiSettings: 'ai:get-settings',
  setAiSettings: 'ai:set-settings',
} as const
