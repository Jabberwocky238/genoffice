import { AI_PROVIDERS } from '../../packages/ai-provider/src/providers'

/** WJKJ model suggestions; leave the community provider catalog unchanged. */
export const WJKJ_AI_PROVIDERS = AI_PROVIDERS.map((provider) => ({
  ...provider,
  models:
    provider.id === 'deepseek'
      ? ['deepseek-v4-flash', 'deepseek-v4-pro', ...provider.models]
      : [...provider.models],
}))
