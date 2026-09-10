import type { AiSettings } from '../../packages/ai-provider/src/types'
import { WJKJ_AI_CHANNELS, type WjkjAiSettingsApi } from './api'

/** The host supplies Electron's invoke; this module exposes only AI settings. */
export function createWjkjAiSettingsApi(
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
): WjkjAiSettingsApi {
  return {
    async getAiSettings() {
      return (await invoke(WJKJ_AI_CHANNELS.getAiSettings)) as AiSettings
    },
    async setAiSettings(settings) {
      await invoke(WJKJ_AI_CHANNELS.setAiSettings, settings)
    },
  }
}
