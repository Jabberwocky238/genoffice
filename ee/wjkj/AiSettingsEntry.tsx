import { useState } from 'react'
import type { AiProviderId, AiSettings } from '../../packages/ai-provider/src/types'
import type { WjkjAiSettingsApi } from './api'
import { WJKJ_AI_PROVIDERS } from './providers'
import './styles.css'

export function AiSettingsEntry({ api, lang }: { api: WjkjAiSettingsApi; lang: string }) {
  const zh = lang === 'zh' || lang === 'zh-TW'
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const providerMeta = WJKJ_AI_PROVIDERS.find((item) => item.id === settings?.provider)
  const config = settings ? settings.providers[settings.provider] : null

  const show = () => {
    setOpen(true)
    setError('')
    void api
      .getAiSettings()
      .then(setSettings)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
  }

  const updateConfig = (patch: Partial<{ apiKey: string; model: string; baseUrl: string }>) => {
    setSettings((current) => {
      if (!current) return current
      return {
        ...current,
        providers: {
          ...current.providers,
          [current.provider]: { ...current.providers[current.provider], ...patch },
        },
      }
    })
  }

  const selectProvider = (provider: AiProviderId) => {
    setSettings((current) => (current ? { ...current, provider } : current))
    setError('')
  }

  const save = async () => {
    if (!settings || !config) return
    if (!config.model.trim()) {
      setError(zh ? '请输入模型名称。' : 'Enter a model name.')
      return
    }
    if (settings.provider === 'custom' && !config.baseUrl?.trim()) {
      setError(zh ? '自定义提供方需要 Base URL。' : 'A custom provider requires a Base URL.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await api.setAiSettings(settings)
      setOpen(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button className="nav-item ai-settings-entry" onClick={show}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 5.5h10M3 10.5h10" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="6" cy="5.5" r="1.6" fill="var(--surface)" stroke="currentColor" />
          <circle cx="10" cy="10.5" r="1.6" fill="var(--surface)" stroke="currentColor" />
        </svg>
        <span className="nav-label">{zh ? '模型与提供方' : 'Models & providers'}</span>
      </button>

      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div
            className="modal ai-settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label={zh ? '模型与提供方' : 'Models and providers'}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="ai-settings-heading">
              <div>
                <h3>{zh ? '模型与提供方' : 'Models and providers'}</h3>
                <p>{zh ? '所有编辑器共用此配置' : 'Shared by all editors'}</p>
              </div>
              <button
                className="icon-btn"
                onClick={() => setOpen(false)}
                aria-label={zh ? '关闭' : 'Close'}
              >
                ×
              </button>
            </div>

            {settings && config ? (
              <div className="ai-settings-form">
                <label>
                  <span>{zh ? '提供方' : 'Provider'}</span>
                  <select
                    value={settings.provider}
                    onChange={(event) => selectProvider(event.target.value as AiProviderId)}
                  >
                    {WJKJ_AI_PROVIDERS.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>{zh ? '模型' : 'Model'}</span>
                  <input
                    value={config.model}
                    list={`models-${settings.provider}`}
                    placeholder={zh ? '输入模型 ID' : 'Enter a model ID'}
                    onChange={(event) => updateConfig({ model: event.target.value })}
                  />
                  <datalist id={`models-${settings.provider}`}>
                    {providerMeta?.models.map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                </label>

                {settings.provider === 'custom' && (
                  <label>
                    <span>Base URL</span>
                    <input
                      value={config.baseUrl ?? ''}
                      placeholder="https://api.example.com/v1"
                      onChange={(event) => updateConfig({ baseUrl: event.target.value })}
                    />
                  </label>
                )}

                {settings.provider !== 'genspark' && (
                  <label>
                    <span>API Key</span>
                    <input
                      type="password"
                      value={config.apiKey}
                      autoComplete="off"
                      placeholder={providerMeta?.keyPlaceholder}
                      onChange={(event) => updateConfig({ apiKey: event.target.value })}
                    />
                  </label>
                )}
              </div>
            ) : !error ? (
              <div className="ai-settings-loading">{zh ? '正在加载…' : 'Loading…'}</div>
            ) : null}

            {error && <div className="ai-settings-error">{error}</div>}
            <div className="modal-buttons">
              <button className="secondary-btn" onClick={() => setOpen(false)}>
                {zh ? '取消' : 'Cancel'}
              </button>
              <button
                className="primary-btn"
                disabled={!settings || saving}
                onClick={() => void save()}
              >
                {saving ? (zh ? '保存中…' : 'Saving…') : zh ? '保存' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
